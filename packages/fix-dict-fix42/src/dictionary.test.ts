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

describe('FIX 4.2 dictionary — integrity', () => {
  it('is internally consistent (no validation errors or warnings)', () => {
    // The Repository expresses every group body inline (via indent), so unlike the flattened
    // 4.4 Markdown there are no empty/approximate groups — the dictionary validates fully clean.
    expect(validateDictionary(dictionary)).toEqual([]);
  });

  it('has the full FIX 4.2 surface', () => {
    expect(Object.keys(dictionary.fields).length).toBe(405);
    // 4.2 predates reusable application components; only the reified header/trailer remain.
    expect(Object.keys(dictionary.components)).toEqual([
      'Standard Message Header',
      'Standard Message Trailer',
    ]);
    expect(dictionary.messages.length).toBe(46);
    expect(Object.keys(dictionary.datatypes).length).toBe(21);
    expect(dictionary.version).toBe('FIX.4.2');
    expect(dictionary.beginString).toBe('FIX.4.2');
  });

  it('records only the backfilled-datatype coverage gaps the 2010 catalog forces', () => {
    const gaps = dictionary.coverageGaps ?? [];
    expect(gaps.map((g) => g.kind)).toEqual(['synthesized-datatype', 'synthesized-datatype']);
    expect(gaps.map((g) => g.where).sort()).toEqual([
      'datatype Length',
      'datatype MultipleValueString',
    ]);
  });

  it('models datatypes with their derivation roots', () => {
    expect(dictionary.datatypes['Price']!.base).toBe('float');
    expect(dictionary.datatypes['Qty']!.base).toBe('float');
    expect(dictionary.datatypes['Boolean']!.base).toBe('char');
    expect(dictionary.datatypes['MonthYear']!.base).toBe('String');
    expect(dictionary.datatypes['data']!.lengthPrefixed).toBe(true);
    expect(dictionary.datatypes['MultipleStringValue']!.multiValueDelimiter).toBe(' ');
    // 4.2 has no NumInGroup datatype — counters are plain `int`, detected structurally.
    expect(dictionary.datatypes['NumInGroup']).toBeUndefined();
    expect(dictionary.fields[78]!.type).toBe('int');
    expect(dictionary.fields[78]!.isGroupCounter).toBe(true);
  });

  it('links every length-prefixed data field to its preceding Length field', () => {
    const dataFields = Object.values(dictionary.fields).filter((f) => f.type === 'data');
    expect(dataFields.length).toBe(14);
    expect(dataFields.every((f) => f.lengthField !== undefined)).toBe(true);
    expect(dictionary.fields[96]!.lengthField).toBe(95); // RawData -> RawDataLength
    expect(dictionary.fields[355]!.lengthField).toBe(354); // EncodedText -> EncodedTextLen
  });

  it('unwraps enum values to opaque on-the-wire strings', () => {
    const side = dictionary.fields[54]!.enumValues!;
    expect(side.find((e) => e.value === '1')!.name).toBe('Buy');
    expect(side.find((e) => e.value === '2')!.name).toBe('Sell');
    expect(side.every((e) => !/[`']/.test(e.value))).toBe(true);
  });

  it('emits typed Tags and MsgType helpers', () => {
    expect(Tags.BeginString).toBe(8);
    expect(Tags.CheckSum).toBe(10);
    expect(Tags.ClOrdID).toBe(11);
    expect(Tags.Side).toBe(54);
    expect(MsgType.Logon).toBe('A');
    expect(MsgType.OrderSingle).toBe('D'); // 4.2 names it "Order - Single", not NewOrderSingle
  });
});

describe('FIX 4.2 dictionary — message structure', () => {
  it('classifies session vs application messages', () => {
    for (const t of ['0', '1', '2', '3', '4', '5', 'A']) {
      expect(dict.messageByMsgType(t)!.category).toBe('admin');
    }
    for (const t of ['D', 'E', '8']) {
      expect(dict.messageByMsgType(t)!.category).toBe('app');
    }
  });

  it('OrderSingle (D): header/trailer bracketing and the NoAllocs group', () => {
    const d = dict.messageByMsgType('D')!;
    expect(d.members[0]).toMatchObject({ kind: 'component', name: 'Standard Message Header' });
    expect(d.members.at(-1)).toMatchObject({ kind: 'component', name: 'Standard Message Trailer' });
    for (const tag of [11, 54, 38, 40, 55]) {
      expect(dict.allowedTags('D')).toContain(tag);
    }
    const allocs = findGroup(d.members, 78)!; // NoAllocs -> AllocAccount, AllocShares
    expect(dict.groupDelimiterTag(allocs)).toBe(79);
    expect(allocs.members.map((m) => (m.kind === 'field' ? m.tag : null))).toEqual([79, 80]);
  });

  it('NewOrderList (E): nests the NoAllocs group inside the NoOrders group', () => {
    const e = dict.messageByMsgType('E')!;
    const orders = findGroup(e.members, 73)!; // NoOrders
    expect(orders.members.length).toBeGreaterThan(0);
    expect(findGroup(orders.members, 78)).toBeDefined(); // NoAllocs nested within an order
  });
});

describe('FIX 4.2 dictionary — corpus-wide invariants', () => {
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

  it('every group is headed by a counter and resolves a delimiter (no gaps in 4.2)', () => {
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
        } else {
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
    expect(seen.size).toBeGreaterThan(200); // the corpus exercises most fields
  });
});
