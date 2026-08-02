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

describe('FIX 5.0 SP2 dictionary — integrity', () => {
  it('is internally consistent (no validation errors or warnings)', () => {
    expect(validateDictionary(dictionary)).toEqual([]);
  });

  it('has the full SP2-over-FIXT surface', () => {
    expect(Object.keys(dictionary.fields).length).toBe(1452);
    expect(Object.keys(dictionary.components).length).toBe(176);
    // 108 base-SP2 application messages + the 7 FIXT session messages (XMLnonFIX
    // deliberately excluded — see the README).
    expect(dictionary.messages.length).toBe(115);
    expect(Object.keys(dictionary.datatypes).length).toBe(28);
  });

  it('carries the FIXT identity split: app version ≠ BeginString, ApplVerID = 9', () => {
    expect(dictionary.version).toBe('FIX.5.0SP2');
    expect(dictionary.beginString).toBe('FIXT.1.1');
    expect(dictionary.applVerID).toBe('9');
    expect(dict.applVerID).toBe('9');
  });

  it('records only the known description coverage gaps', () => {
    const gaps = dictionary.coverageGaps ?? [];
    expect(gaps.map((g) => g.kind).sort()).toEqual([
      'missing-description',
      'missing-description',
      'missing-enum-descriptions',
    ]);
  });

  it('models the FIX 5.0 datatypes with their derivation roots', () => {
    expect(dictionary.datatypes['Price']!.base).toBe('float');
    expect(dictionary.datatypes['Boolean']!.base).toBe('char');
    expect(dictionary.datatypes['data']!.lengthPrefixed).toBe(true);
    // SP2 splits 4.4's MultipleValueString into char/string token-list variants.
    expect(dictionary.datatypes['MultipleCharValue']!.multiValueDelimiter).toBe(' ');
    expect(dictionary.datatypes['MultipleStringValue']!.multiValueDelimiter).toBe(' ');
    expect(dictionary.datatypes['TZTimestamp']!.formatPattern).toBeDefined();
    expect(dictionary.datatypes['TZTimeOnly']!.formatPattern).toBeDefined();
    expect(dictionary.datatypes['XMLData']!.base).toBe('data');
    expect(dictionary.datatypes['Language']!.base).toBe('String');
    expect(dictionary.fields[268]!.isGroupCounter).toBe(true); // NoMDEntries
  });

  it('links length-prefixed data fields, including the FIXT envelope pairs', () => {
    expect(dictionary.fields[96]!.lengthField).toBe(95); // RawData → RawDataLength
    expect(dictionary.fields[355]!.lengthField).toBe(354); // EncodedText → EncodedTextLen
    // These pairs appear structurally ONLY in the FIXT envelope; the merge carries the link.
    expect(dictionary.fields[89]!.lengthField).toBe(93); // Signature → SignatureLength
    expect(dictionary.fields[91]!.lengthField).toBe(90); // SecureData → SecureDataLen
    expect(dictionary.fields[213]!.lengthField).toBe(212); // XmlData → XmlDataLen
  });

  it('emits typed Tags and MsgType helpers, including the FIXT session fields', () => {
    expect(Tags.BeginString).toBe(8);
    expect(Tags.ApplVerID).toBe(1128);
    expect(Tags.DefaultApplVerID).toBe(1137);
    expect(Tags.ApplExtID).toBe(1156);
    expect(MsgType.Logon).toBe('A');
    expect(MsgType.NewOrderSingle).toBe('D');
    expect(MsgType.BusinessMessageReject).toBe('j');
  });
});

describe('FIX 5.0 SP2 dictionary — FIXT layering', () => {
  it('classifies the 7 FIXT session messages admin and the app layer app', () => {
    for (const t of ['0', '1', '2', '3', '4', '5', 'A']) {
      expect(dict.messageByMsgType(t)!.category).toBe('admin');
    }
    // BusinessMessageReject is an APPLICATION message under FIXT, unlike session Reject(3).
    for (const t of ['D', '8', 'W', 'j']) {
      expect(dict.messageByMsgType(t)!.category).toBe('app');
    }
    expect(dictionary.messages.filter((m) => m.category === 'admin')).toHaveLength(7);
  });

  it('does not ship XMLnonFIX(n) — parse falls back to unknown-msgtype (see README)', () => {
    expect(dict.messageByMsgType('n')).toBeUndefined();
  });

  it('the header is the FIXT superset: ApplVerID/CstmApplVerID/ApplExtID + HopGrp', () => {
    const header = dictionary.components['Standard Message Header']!;
    const tags = header.members.filter((m) => m.kind === 'field').map((m) => m.tag);
    expect(tags.slice(0, 3)).toEqual([8, 9, 35]);
    for (const t of [1128, 1129, 1156]) {
      expect(tags, `header carries ${t}`).toContain(t);
    }
    expect(header.members.some((m) => m.kind === 'component' && m.name === 'HopGrp')).toBe(true);
  });

  it('Logon (A) requires DefaultApplVerID(1137)', () => {
    const logon = dict.messageByMsgType('A')!;
    expect(logon.members).toContainEqual({ kind: 'field', tag: 1137, reqd: 'Y' });
    // The optional extension-pack companions ride along.
    expect(dict.allowedTags('A')).toContain(1407);
    expect(dict.allowedTags('A')).toContain(1408);
  });

  it('NewOrderSingle (D): envelope bracketing and the SP2 Parties component', () => {
    const d = dict.messageByMsgType('D')!;
    expect(d.members[0]).toMatchObject({ kind: 'component', name: 'Standard Message Header' });
    expect(d.members.at(-1)).toMatchObject({ kind: 'component', name: 'Standard Message Trailer' });
    for (const tag of [11, 54, 38, 40, 55, 1128]) {
      expect(dict.allowedTags('D')).toContain(tag);
    }
  });

  it('MarketDataSnapshotFullRefresh (W): NoMDEntries behind MDFullGrp resolves', () => {
    const w = dict.messageByMsgType('W')!;
    const grpComp = dictionary.components['MDFullGrp']!;
    const md = findGroup(grpComp.members, 268)!;
    expect(md).toBeDefined();
    expect(dict.groupDelimiterTag(md)).toBe(269); // MDEntryType opens each entry
    expect(dict.allowedTags(w.msgType)).toContain(269);
  });
});

describe('FIX 5.0 SP2 dictionary — corpus-wide invariants', () => {
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

  it('every group is headed by a counter and resolves a delimiter', () => {
    const check = (g: GroupMember, where: string): void => {
      expect(
        dict.fieldByTag(g.counterTag)?.isGroupCounter,
        `${where} counter ${g.counterTag}`,
      ).toBe(true);
      expect(g.members.length, `${where} group ${g.counterTag} body`).toBeGreaterThan(0);
      expect(dict.groupDelimiterTag(g), `${where} group ${g.counterTag} delimiter`).toBeTypeOf(
        'number',
      );
    };
    for (const m of dictionary.messages) {
      eachGroup(m.members, (g) => check(g, `message ${m.name}`));
    }
    for (const c of Object.values(dictionary.components)) {
      eachGroup(c.members, (g) => check(g, `component ${c.name}`));
    }
  });

  it('every referenced field tag exists in the field table', () => {
    const seen = new Set<number>();
    const seenComps = new Set<string>();
    const walk = (members: MemberRef[]): void => {
      for (const m of members) {
        if (m.kind === 'field') {
          seen.add(m.tag);
        } else if (m.kind === 'group') {
          seen.add(m.counterTag);
          walk(m.members);
        } else if (!seenComps.has(m.name)) {
          seenComps.add(m.name);
          const c = dict.component(m.name);
          if (c) {
            walk(c.members);
          }
        }
      }
    };
    for (const m of dictionary.messages) {
      walk(m.members);
    }
    for (const tag of seen) {
      expect(dict.fieldByTag(tag), `field ${tag}`).toBeDefined();
    }
    expect(seen.size).toBeGreaterThan(1000); // the SP2 corpus exercises most fields
  });
});
