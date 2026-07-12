import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  type GroupMember,
  createFixEngine,
  defineExtension,
  extendDictionary,
  extendTags,
  invertTags,
  loadDictionary,
  tagsOf,
  toEncodeMessage,
  validateDictionary,
} from '@boarteam/fix';
import { Tags, dictionary } from './index';

// The motivating real-world case for dictionary extensibility: cTrader transmits
// SymbolName(1007)/SymbolDigits(1008) INSIDE SecurityList's NoRelatedSym repeating
// group. Without the extension the group walker treats 1007 as "group ended", walks
// out after the first instrument, and mis-nests everything that follows.
const ctrader = defineExtension({
  id: 'ctrader',
  fields: {
    SymbolName: { tag: 1007, type: 'String' },
    SymbolDigits: { tag: 1008, type: 'int' },
  },
  messages: {
    SecurityList: { groups: { NoRelatedSym: { append: ['SymbolName', 'SymbolDigits'] } } },
  },
});

const { dictionary: extended, issues: extendIssues } = extendDictionary(dictionary, ctrader);

/** A 3-instrument cTrader-style SecurityList, pipe-delimited (framing not asserted). */
const RAW = [
  '8=FIX.4.4',
  '9=0',
  '35=y',
  '49=cServer',
  '56=client',
  '34=2',
  '52=20260712-09:00:00',
  '320=req-1',
  '322=resp-1',
  '560=0',
  '146=3',
  '55=1',
  '1007=EURUSD',
  '1008=5',
  '55=2',
  '1007=GBPUSD',
  '1008=5',
  '55=3',
  '1007=USDJPY',
  '1008=3',
  '10=000',
  '',
].join('|');

describe('extending FIX 4.4 with the cTrader SecurityList tags', () => {
  it('applies with advisory issues only and stays gate-clean', () => {
    expect(extendIssues.filter((i) => i.severity !== 'info')).toEqual([]);
    const codes = extendIssues.map((i) => i.code);
    expect(codes.filter((c) => c === 'extend/tag-outside-user-range')).toHaveLength(2);
    const fanout = extendIssues.find((i) => i.code === 'extend/component-fanout')!;
    expect(fanout.message).toContain('SecListGrp');

    expect(validateDictionary(extended)).toEqual([]);
    expect(extended.extensions).toEqual(['ctrader']);
    expect(extended.fields[1007]).toEqual({ tag: 1007, name: 'SymbolName', type: 'String' });
  });

  it('keeps the NoRelatedSym entry delimiter at Symbol (55) — regression pin', () => {
    const dict = loadDictionary(extended);
    const group = extended.components['SecListGrp']!.members[0] as GroupMember;
    expect(group.counterTag).toBe(146);
    expect(dict.groupDelimiterTag(group)).toBe(55);
    // The custom tags sit at the END of the entry body:
    expect(group.members.slice(-2)).toEqual([
      { kind: 'field', tag: 1007, reqd: 'N' },
      { kind: 'field', tag: 1008, reqd: 'N' },
    ]);
  });

  it('mis-nests with the stock dictionary (the bug this feature fixes)', () => {
    const stock = createFixEngine(dictionary);
    const { message, issues } = stock.parse(RAW, { soh: '|', checkFraming: false });
    expect(issues.map((i) => i.code)).toContain('parse/group-count-mismatch');
    expect(message.groups[146] ?? []).not.toHaveLength(3);
  });

  it('parses a multi-instrument SecurityList correctly with the extended dictionary', () => {
    const engine = createFixEngine(extended);
    const { message, issues } = engine.parse(RAW, { soh: '|', checkFraming: false });
    expect(issues).toEqual([]);

    const entries = message.groups[146]!;
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.fields[1007]!.raw)).toEqual(['EURUSD', 'GBPUSD', 'USDJPY']);
    expect(entries.map((e) => e.fields[1008]!.value)).toEqual([5, 5, 3]);
    expect(entries.map((e) => e.fields[55]!.raw)).toEqual(['1', '2', '3']);
    // Nothing hoisted to the top level:
    expect(message.fields[1007]).toBeUndefined();
    expect(message.fields[55]).toBeUndefined();
  });

  it('round-trips: encode places the custom tags per entry and re-parse agrees', () => {
    const engine = createFixEngine(extended);
    const wire = engine.encode({
      msgType: 'y',
      fields: {
        49: 'cServer',
        56: 'client',
        34: '2',
        52: '20260712-09:00:00',
        320: 'req-1',
        322: 'resp-1',
        560: '0',
      },
      groups: {
        146: [
          { fields: { 55: '1', 1007: 'EURUSD', 1008: '5' } },
          { fields: { 55: '2', 1007: 'GBPUSD', 1008: '5' } },
          { fields: { 55: '3', 1007: 'USDJPY', 1008: '3' } },
        ],
      },
    });
    // Each entry carries its own 1007/1008 (they round-trip, not just parse):
    expect(wire.match(/1007=/g)).toHaveLength(3);

    const { message, issues } = engine.parse(wire);
    expect(issues).toEqual([]);
    expect(message.framed).toBe(true);
    const entries = message.groups[146]!;
    expect(entries.map((e) => e.fields[1007]!.raw)).toEqual(['EURUSD', 'GBPUSD', 'USDJPY']);

    // Byte-identical re-encode, and the dictionary conformance gate is clean:
    expect(engine.encode(toEncodeMessage(message))).toBe(wire);
    expect(engine.validate(message)).toEqual([]);
  });

  it('drives the typed maps from the same declaration', () => {
    const VenueTags = extendTags(Tags, tagsOf(ctrader));
    const VenueTagNames = invertTags(VenueTags);

    expectTypeOf(VenueTags.SymbolName).toEqualTypeOf<1007>();
    expectTypeOf(VenueTags.Symbol).toEqualTypeOf<55>();
    expectTypeOf(VenueTagNames[1007]).toEqualTypeOf<'SymbolName'>();
    expect(VenueTags.SymbolName).toBe(1007);
    expect(VenueTagNames[1007]).toBe('SymbolName');
    expect(VenueTagNames[55]).toBe('Symbol');
    // The full base map survives: 900+ standard names plus the two venue tags.
    expect(Object.keys(VenueTags).length).toBe(Object.keys(Tags).length + 2);
  });
});
