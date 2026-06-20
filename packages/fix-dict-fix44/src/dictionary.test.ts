import { describe, expect, it } from 'vitest';
import {
  type GroupMember,
  loadDictionary,
  type MemberRef,
  validateDictionary,
} from '@boarteam/fix';
import { dictionary, MsgType, Tags } from './index';

const dict = loadDictionary(dictionary);

/** Find a group by counter tag anywhere in a member tree (descending into nested groups). */
function findGroup(members: MemberRef[], counterTag: number): GroupMember | undefined {
  for (const m of members) {
    if (m.kind === 'group') {
      if (m.counterTag === counterTag) {
        return m;
      }
      const nested = findGroup(m.members, counterTag);
      if (nested) {
        return nested;
      }
    }
  }
  return undefined;
}

/** Collect field tags from members, expanding components but NOT descending into groups. */
function flatTags(members: MemberRef[]): Set<number> {
  const out = new Set<number>();
  const walk = (ms: MemberRef[]): void => {
    for (const m of ms) {
      if (m.kind === 'field') {
        out.add(m.tag);
      } else if (m.kind === 'component') {
        const c = dict.component(m.name);
        if (c) {
          walk(c.members);
        }
      } else {
        out.add(m.counterTag); // the counter is flat; its body is not
      }
    }
  };
  walk(members);
  return out;
}

describe('FIX 4.4 dictionary — integrity', () => {
  it('is internally consistent (no validation errors)', () => {
    const errors = validateDictionary(dictionary).filter((i) => i.severity === 'error');
    expect(errors).toEqual([]);
  });

  it('has the full FIX 4.4 surface', () => {
    expect(Object.keys(dictionary.fields).length).toBe(912);
    expect(Object.keys(dictionary.components).length).toBe(26);
    expect(dictionary.messages.length).toBe(93);
    expect(Object.keys(dictionary.datatypes).length).toBe(25);
    expect(dictionary.version).toBe('FIX.4.4');
    expect(dictionary.beginString).toBe('FIX.4.4');
  });

  it('records honest coverage gaps; unresolved ones never touch the MD/session subset', () => {
    const gaps = dictionary.coverageGaps ?? [];
    const counterOf = (g: { where: string }) => Number(g.where.match(/NoXxx (\d+)/)![1]);
    const distinct = (kind: string) =>
      [...new Set(gaps.filter((g) => g.kind === kind).map(counterOf))].sort((a, b) => a - b);

    // Two honest gap kinds only.
    expect(new Set(gaps.map((g) => g.kind))).toEqual(
      new Set(['unresolved-group', 'approximate-group']),
    );
    // Bodiless nested sub-groups the flattened Markdown never expresses inline anywhere.
    expect(distinct('unresolved-group')).toEqual([576, 670, 801, 802, 804, 806, 952]);
    // Counters whose bodies vary by context: filled with the minimal canonical body.
    expect(distinct('approximate-group')).toEqual([78, 555, 711]);

    // The *unresolved* (empty) gaps must not occur in the supported subset; approximate
    // gaps may (711/555 nest there) — those groups are resolved, just minimal.
    const subsetNames = new Set(
      ['0', '1', '2', '3', '4', '5', 'A', 'V', 'W', 'X', 'Y', 'x', 'y'].map(
        (t) => dict.messageByMsgType(t)?.name,
      ),
    );
    const unresolvedInSubset = gaps
      .filter((g) => g.kind === 'unresolved-group')
      .some((g) => [...subsetNames].some((n) => n && g.where.includes(n)));
    expect(unresolvedInSubset).toBe(false);
  });

  it('models datatypes with their derivation roots', () => {
    expect(dictionary.datatypes['Price']!.base).toBe('float');
    expect(dictionary.datatypes['Qty']!.base).toBe('float');
    expect(dictionary.datatypes['Boolean']!.base).toBe('char');
    expect(dictionary.datatypes['NumInGroup']!.base).toBe('int');
    expect(dictionary.datatypes['month-year']!.base).toBe('String');
    expect(dictionary.datatypes['data']!.lengthPrefixed).toBe(true);
    expect(dictionary.datatypes['MultipleValueString']!.multiValueDelimiter).toBe(' ');
  });

  it('links every length-prefixed data field to its preceding Length field', () => {
    const dataFields = Object.values(dictionary.fields).filter((f) => f.type === 'data');
    expect(dataFields.length).toBe(16);
    expect(dataFields.every((f) => f.lengthField !== undefined)).toBe(true);
    expect(dictionary.fields[96]!.lengthField).toBe(95); // RawData -> RawDataLength
    expect(dictionary.fields[355]!.lengthField).toBe(354); // EncodedText -> EncodedTextLen
  });

  it('unwraps enum values to opaque on-the-wire strings, preserving leading zeros', () => {
    const side = dictionary.fields[54]!.enumValues!;
    expect(side.find((e) => e.value === '1')!.name).toBe('Buy');
    // No value retains the `` `'…'` `` wrapper.
    expect(side.every((e) => !/[`']/.test(e.value))).toBe(true);

    const currency = dictionary.fields[15]!.enumValues!;
    expect(currency.some((e) => e.value === '004')).toBe(true); // ISO numeric code, not 4
    expect(currency.some((e) => e.value === 'USD')).toBe(true);
  });

  it('emits typed Tags and MsgType helpers (incl. the 311/310 guard)', () => {
    expect(Tags.BeginString).toBe(8);
    expect(Tags.CheckSum).toBe(10);
    expect(Tags.UnderlyingSymbol).toBe(311);
    expect(Tags.UnderlyingSecurityType).toBe(310);
    expect(MsgType.Logon).toBe('A');
    expect(MsgType.MarketDataRequest).toBe('V');
    // The mid-string parenthetical pair keeps distinct, informative keys (no lossy collision).
    expect(MsgType.NetworkStatusRequest).toBe('BC');
    expect(MsgType.NetworkStatusResponse).toBe('BD');
  });
});

// Expectations below are derived from the curated reference definitions (the conformance
// oracle); they are checked-in golden values, not a live diff against any external source.
describe('FIX 4.4 dictionary — reconciliation with the conformance oracle', () => {
  it('classifies session vs application messages', () => {
    for (const t of ['0', '1', '2', '3', '4', '5', 'A']) {
      expect(dict.messageByMsgType(t)!.category).toBe('admin');
    }
    for (const t of ['V', 'W', 'X', 'y']) {
      expect(dict.messageByMsgType(t)!.category).toBe('app');
    }
  });

  it('Logon (A): header first, trailer last, with the NoMsgTypes group', () => {
    const a = dict.messageByMsgType('A')!;
    expect(a.members[0]).toMatchObject({ kind: 'component', name: 'Standard Message Header' });
    expect(a.members.at(-1)).toMatchObject({ kind: 'component', name: 'Standard Message Trailer' });
    expect(dict.allowedTags('A')).toContain(98); // EncryptMethod
    expect(dict.allowedTags('A')).toContain(108); // HeartBtInt
    expect(findGroup(a.members, 384)).toBeDefined(); // NoMsgTypes -> {372,385}
  });

  it('Market Data Request (V): NoMDEntryTypes and the instrument group', () => {
    const allowed = dict.allowedTags('V');
    for (const tag of [262, 263, 264, 265, 267, 269, 146, 55, 48, 22, 461, 207, 107]) {
      expect(allowed).toContain(tag);
    }
    const v = dict.messageByMsgType('V')!;
    expect(dict.groupDelimiterTag(findGroup(v.members, 267)!)).toBe(269);
    expect(dict.groupDelimiterTag(findGroup(v.members, 146)!)).toBe(55); // through Instrument
    // Negative: a tag from an unrelated message must NOT be permitted (catches over-permission).
    expect(allowed.has(98)).toBe(false); // EncryptMethod belongs to Logon, not V
  });

  it('Market Data Snapshot (W): NoMDEntries group keyed by MDEntryType', () => {
    const w = dict.messageByMsgType('W')!;
    expect(dict.groupDelimiterTag(findGroup(w.members, 268)!)).toBe(269);
    for (const tag of [262, 55, 268, 269, 270, 271, 272, 273]) {
      expect(dict.allowedTags('W')).toContain(tag);
    }
  });

  it('Market Data Incremental (X): nested NoUnderlyings/NoLegs resolved canonically', () => {
    const x = dict.messageByMsgType('X')!;
    const entries = findGroup(x.members, 268)!;
    const underlyings = findGroup(entries.members, 711)!;
    expect(underlyings.bodyFromCanonical).toBe(true);
    expect(dict.groupDelimiterTag(underlyings)).toBe(311);
    // Full canonical body, not just the delimiter: the minimal Underlying Instrument block.
    expect(underlyings.members).toEqual([
      { kind: 'component', name: 'Underlying Instrument', reqd: 'C' },
    ]);
    expect(findGroup(entries.members, 555)!.bodyFromCanonical).toBe(true);
    expect(findGroup(entries.members, 555)!.members).toEqual([
      { kind: 'component', name: 'Instrument Leg', reqd: 'C' },
    ]);
  });

  it('Security List (y): 311 lives inside the NoUnderlyings (711) group, never flat', () => {
    const y = dict.messageByMsgType('y')!;
    for (const tag of [320, 322, 560, 146, 55, 15, 711, 311, 555, 600]) {
      expect(dict.allowedTags('y')).toContain(tag);
    }
    // The 311 placement guard: not a flat member, only reachable through group 711.
    expect(flatTags(y.members).has(311)).toBe(false);
    const related = findGroup(y.members, 146)!;
    expect(dict.groupDelimiterTag(findGroup(related.members, 711)!)).toBe(311);
    expect(dict.groupDelimiterTag(findGroup(related.members, 555)!)).toBe(600);
  });
});

describe('FIX 4.4 dictionary — corpus-wide invariants', () => {
  /** Counter tags of the bodiless nested groups (the `unresolved-group` coverage gaps). */
  const UNRESOLVED = new Set(
    (dictionary.coverageGaps ?? [])
      .filter((g) => g.kind === 'unresolved-group')
      .map((g) => Number(g.where.match(/NoXxx (\d+)/)![1])),
  );

  function eachGroup(members: MemberRef[], visit: (g: GroupMember) => void): void {
    for (const m of members) {
      if (m.kind === 'group') {
        visit(m);
        eachGroup(m.members, visit);
      }
    }
  }

  it('every message brackets its body with the standard header and trailer', () => {
    for (const m of dictionary.messages) {
      expect(m.members[0], m.name).toMatchObject({
        kind: 'component',
        name: 'Standard Message Header',
      });
      expect(m.members.at(-1), m.name).toMatchObject({
        kind: 'component',
        name: 'Standard Message Trailer',
      });
      const allowed = dict.allowedTags(m.msgType);
      for (const framing of [8, 9, 35, 10]) {
        expect(allowed, `${m.name} allows ${framing}`).toContain(framing);
      }
    }
  });

  it('every message has a unique MsgType and a known category', () => {
    const seen = new Set<string>();
    for (const m of dictionary.messages) {
      expect(seen.has(m.msgType), `duplicate MsgType ${m.msgType}`).toBe(false);
      seen.add(m.msgType);
      expect(['admin', 'app']).toContain(m.category);
    }
  });

  it('every group is headed by a real NumInGroup counter and resolves a delimiter unless a known gap', () => {
    const check = (g: GroupMember, where: string): void => {
      expect(
        dict.fieldByTag(g.counterTag)?.isGroupCounter,
        `${where} counter ${g.counterTag}`,
      ).toBe(true);
      if (UNRESOLVED.has(g.counterTag) && g.members.length === 0) {
        return; // documented coverage gap
      }
      expect(g.members.length, `${where} group ${g.counterTag} body`).toBeGreaterThan(0);
      expect(dict.groupDelimiterTag(g), `${where} group ${g.counterTag} delimiter`).toBeTypeOf(
        'number',
      );
    };
    for (const c of Object.values(dictionary.components)) {
      eachGroup(c.members, (g) => check(g, `component ${c.name}`));
    }
    for (const m of dictionary.messages) {
      eachGroup(m.members, (g) => check(g, `message ${m.name}`));
    }
  });

  it('every referenced field tag exists in the field table', () => {
    const seen = new Set<number>();
    const walk = (members: MemberRef[]): void => {
      for (const m of members) {
        if (m.kind === 'field') {
          seen.add(m.tag);
        } else if (m.kind === 'group') {
          seen.add(m.counterTag);
          walk(m.members);
        }
      }
    };
    for (const c of Object.values(dictionary.components)) {
      walk(c.members);
    }
    for (const m of dictionary.messages) {
      walk(m.members);
    }
    for (const tag of seen) {
      expect(dict.fieldByTag(tag), `field ${tag}`).toBeDefined();
    }
    expect(seen.size).toBeGreaterThan(400); // sanity: the corpus exercises most fields
  });

  it("validator's empty-group warnings reconcile with the generator's unresolved-group gaps", () => {
    const issues = validateDictionary(dictionary);
    // No structural errors anywhere in the shipped dictionary.
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
    // The only warnings are empty-group, and the tags they flag are exactly the
    // generator's bodiless (unresolved) counters — the two independent accountings agree.
    const emptyGroupTags = new Set(
      issues.filter((i) => i.code === 'dict/empty-group').map((i) => i.refTagID!),
    );
    expect(emptyGroupTags).toEqual(UNRESOLVED);
    expect(issues.every((i) => i.severity === 'error' || i.code === 'dict/empty-group')).toBe(true);
  });
});
