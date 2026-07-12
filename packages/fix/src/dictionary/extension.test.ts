import { describe, expect, expectTypeOf, it } from 'vitest';
import { extendTags, invertTags } from './extendTags';
import { type DictionaryExtension, defineExtension, msgTypesOf, tagsOf } from './extension';

// The one-declaration bridge: a single defineExtension declaration drives both the
// runtime dictionary merge (extendDictionary, tested separately) and the literal typed
// maps below. Type pins are enforced by `pnpm typecheck`.

const ctrader = defineExtension({
  id: 'ctrader',
  fields: {
    SymbolName: { tag: 1007, type: 'String' },
    SymbolDigits: { tag: 1008, type: 'int' },
  },
  messages: {
    SecurityList: { groups: { NoRelatedSym: { append: ['SymbolName', 'SymbolDigits'] } } },
    CTraderPing: { msgType: 'UP1', members: ['SymbolName'] },
  },
});

describe('defineExtension', () => {
  it('is an identity at runtime', () => {
    const value = { fields: { A: { tag: 5001, type: 'int' } } } as const;
    expect(defineExtension(value)).toBe(value);
  });

  it('pins literals without as const', () => {
    expectTypeOf(ctrader.fields.SymbolName.tag).toEqualTypeOf<1007>();
    expectTypeOf(ctrader.messages.CTraderPing.msgType).toEqualTypeOf<'UP1'>();
    expect(ctrader.fields.SymbolName.tag).toBe(1007);
  });

  it('rejects a message entry mixing patch and new-message shapes at compile time', () => {
    // A msgType alongside patch-only keys is neither a NewMessageSpec (members missing)
    // nor a MessageExtension (msgType is `never` there) — the mistake must not compile.
    defineExtension({
      messages: {
        // @ts-expect-error — msgType plus groups is an invalid mix
        Broken: { msgType: 'U1', groups: {} },
      },
    });
  });

  it('rejects a pre-declared (widened) extension at compile time', () => {
    const widened: DictionaryExtension = {
      fields: { SymbolName: { tag: 1007, type: 'String' } },
    };
    // @ts-expect-error — widened tag literals must be a readable error, not a silent
    // degradation of the derived Tags map to `number`.
    defineExtension(widened);
    // An `as const` pre-declaration keeps literals and passes:
    const fine = { fields: { SymbolName: { tag: 1007, type: 'String' } } } as const;
    const pinned = defineExtension(fine);
    expectTypeOf(pinned.fields.SymbolName.tag).toEqualTypeOf<1007>();
  });
});

describe('tagsOf', () => {
  it('derives the literal name → tag map from the declaration', () => {
    const tags = tagsOf(ctrader);
    expect(tags).toEqual({ SymbolName: 1007, SymbolDigits: 1008 });
    expectTypeOf(tags.SymbolName).toEqualTypeOf<1007>();
    expectTypeOf(tags.SymbolDigits).toEqualTypeOf<1008>();
  });

  it('returns an empty map for a fieldless extension', () => {
    expect(tagsOf(defineExtension({ messages: {} }))).toEqual({});
  });

  it('feeds extendTags/invertTags with full literal typing (the two layers connect)', () => {
    const BaseTags = { Symbol: 55 } as const;
    const Tags = extendTags(BaseTags, tagsOf(ctrader));
    const TagNames = invertTags(Tags);
    expectTypeOf(Tags.SymbolName).toEqualTypeOf<1007>();
    expectTypeOf(TagNames[1007]).toEqualTypeOf<'SymbolName'>();
    expect(Tags.SymbolName).toBe(1007);
    expect(TagNames[1007]).toBe('SymbolName');
  });
});

describe('msgTypesOf', () => {
  it('derives new messages and skips patches', () => {
    const msgTypes = msgTypesOf(ctrader);
    expect(msgTypes).toEqual({ CTraderPing: 'UP1' });
    expectTypeOf(msgTypes.CTraderPing).toEqualTypeOf<'UP1'>();
    // The SecurityList patch (no msgType) must not appear, at type or value level:
    expect('SecurityList' in msgTypes).toBe(false);
    expectTypeOf<keyof typeof msgTypes>().toEqualTypeOf<'CTraderPing'>();
  });

  it('returns an empty map for an extension without new messages', () => {
    expect(msgTypesOf(defineExtension({ fields: {} }))).toEqual({});
  });
});
