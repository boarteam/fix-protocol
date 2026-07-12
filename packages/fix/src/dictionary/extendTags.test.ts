import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  type ExtendMsgTypes,
  type ExtendTags,
  type InvertMsgTypes,
  type InvertTags,
  extendMsgTypes,
  extendTags,
  invertMsgTypes,
  invertTags,
} from './extendTags';

// A miniature stand-in for a shipped dict package's `Tags`/`MsgType` maps
// (`as const`, literal-typed) — packages/fix tests never depend on the dict packages.
// The `expectTypeOf` pins are enforced by `pnpm typecheck` (tsc covers src, tests included).
const BaseTags = {
  Symbol: 55,
  SecurityID: 48,
  NoRelatedSym: 146,
} as const;

const BaseMsgTypes = {
  Logon: 'A',
  SecurityList: 'y',
} as const;

describe('extendTags', () => {
  const Tags = extendTags(BaseTags, { SymbolName: 1007, SymbolDigits: 1008 });

  it('merges extension entries over the base map', () => {
    expect(Tags).toEqual({
      Symbol: 55,
      SecurityID: 48,
      NoRelatedSym: 146,
      SymbolName: 1007,
      SymbolDigits: 1008,
    });
  });

  it('never mutates the base map', () => {
    const base = { Symbol: 55 };
    const extended = extendTags(base, { SymbolName: 1007 });
    expect(base).toEqual({ Symbol: 55 });
    expect(extended).not.toBe(base);
  });

  it('lets the extension win on a name collision (spread semantics)', () => {
    const overridden = extendTags(BaseTags, { Symbol: 9955 });
    expect(overridden.Symbol).toBe(9955);

    // The type mirrors the runtime: the extension's literal replaces the base's —
    // a key-remapped merge, never the `55 & 9955 = never` of a naive intersection.
    expectTypeOf(overridden.Symbol).toEqualTypeOf<9955>();
  });

  it('keeps literal types for both base and extension entries', () => {
    expectTypeOf(Tags.SymbolName).toEqualTypeOf<1007>();
    expectTypeOf(Tags.Symbol).toEqualTypeOf<55>();
    expectTypeOf<keyof typeof Tags>().toEqualTypeOf<
      'Symbol' | 'SecurityID' | 'NoRelatedSym' | 'SymbolName' | 'SymbolDigits'
    >();
    expect(Tags.SymbolName).toBe(1007);
  });
});

describe('invertTags', () => {
  const Tags = extendTags(BaseTags, { SymbolName: 1007, SymbolDigits: 1008 });
  const TagNames = invertTags(Tags);

  it('inverts every entry (bijection, mirroring the shipped names.test.ts contract)', () => {
    const names = Object.keys(Tags) as (keyof typeof Tags)[];
    expect(Object.keys(TagNames)).toHaveLength(names.length);
    for (const name of names) {
      expect(TagNames[Tags[name]]).toBe(name);
    }
  });

  it('returns undefined for tags outside the map', () => {
    expect(TagNames[99999]).toBeUndefined();
  });

  it('keeps last-write-wins on duplicate tag values (spread parity)', () => {
    // Two names on one tag is a data problem `extendDictionary` reports; the map
    // helper stays total and mirrors object-spread semantics: the later key wins.
    const clashed = invertTags({ Text: 58, ReasonText: 58 });
    expect(clashed[58]).toBe('ReasonText');
  });

  it('types known tags as literals and arbitrary numbers as name | undefined', () => {
    expectTypeOf(TagNames[1007]).toEqualTypeOf<'SymbolName'>();
    expectTypeOf(TagNames[55]).toEqualTypeOf<'Symbol'>();

    const someTag = Number(process.env['NON_LITERAL'] ?? 55);
    const looked = TagNames[someTag];
    expectTypeOf(looked).toEqualTypeOf<keyof typeof Tags | undefined>();
    expect(looked).toBe('Symbol');
  });
});

describe('extendMsgTypes / invertMsgTypes', () => {
  const MsgType = extendMsgTypes(BaseMsgTypes, { CTraderPing: 'UP1' });
  const MsgTypeNames = invertMsgTypes(MsgType);

  it('merges and inverts message-type maps', () => {
    expect(MsgType).toEqual({ Logon: 'A', SecurityList: 'y', CTraderPing: 'UP1' });
    const names = Object.keys(MsgType) as (keyof typeof MsgType)[];
    expect(Object.keys(MsgTypeNames)).toHaveLength(names.length);
    for (const name of names) {
      expect(MsgTypeNames[MsgType[name]]).toBe(name);
    }
  });

  it('returns undefined for unknown values', () => {
    expect(MsgTypeNames['ZZ']).toBeUndefined();
  });

  it('keeps literal types on both sides', () => {
    expectTypeOf(MsgType.CTraderPing).toEqualTypeOf<'UP1'>();
    expectTypeOf(MsgTypeNames['UP1']).toEqualTypeOf<'CTraderPing'>();

    const someType = String(process.env['NON_LITERAL'] ?? 'A');
    const looked = MsgTypeNames[someType];
    expectTypeOf(looked).toEqualTypeOf<keyof typeof MsgType | undefined>();
    expect(looked).toBe('Logon');
  });
});

describe('typing edge cases', () => {
  it('degrades (but compiles) when the extension was pre-declared with a widened type', () => {
    // Passing a widened variable cannot keep literals — the `const` type parameter
    // only pins call-site literals. The result is still a correct runtime map; the
    // one-declaration path (`defineExtension`, next milestone) turns this into a
    // compile error instead.
    const widened: Record<string, number> = { SymbolName: 1007 };
    const Tags = extendTags(BaseTags, widened);
    expect(Tags['SymbolName']).toBe(1007);
    // `undefined` joins via noUncheckedIndexedAccess: the widened map erases the
    // literal keys, so access falls through to the index signature.
    expectTypeOf(Tags['SymbolName']).toEqualTypeOf<number | undefined>();
  });

  it('annotated exports type-check (the .d.ts-size escape hatch for venue packages)', () => {
    // Venue modules that emit declarations should annotate with the alias types so
    // tsc emits nominal references instead of inlining the full base map structurally.
    const ext = { SymbolName: 1007, SymbolDigits: 1008 } as const;
    const Tags: ExtendTags<typeof BaseTags, typeof ext> = extendTags(BaseTags, ext);
    const TagNames: InvertTags<typeof Tags> = invertTags(Tags);
    const MsgType: ExtendMsgTypes<typeof BaseMsgTypes, { readonly CTraderPing: 'UP1' }> =
      extendMsgTypes(BaseMsgTypes, { CTraderPing: 'UP1' });
    const MsgTypeNames: InvertMsgTypes<typeof MsgType> = invertMsgTypes(MsgType);

    expectTypeOf(Tags.SymbolName).toEqualTypeOf<1007>();
    expectTypeOf(TagNames[1008]).toEqualTypeOf<'SymbolDigits'>();
    expectTypeOf(MsgTypeNames['UP1']).toEqualTypeOf<'CTraderPing'>();
    expect(TagNames[1008]).toBe('SymbolDigits');
    expect(MsgTypeNames['UP1']).toBe('CTraderPing');
  });

  it('computed keys built from extended tags stay number-valued', () => {
    const Tags = extendTags(BaseTags, { SymbolName: 1007 });
    // boar-trading indexes records by tag: `{ [Tags.X]: … }` must compile.
    const byTag = { [Tags.SymbolName]: 'EURUSD' };
    expect(byTag[1007]).toBe('EURUSD');
  });
});
