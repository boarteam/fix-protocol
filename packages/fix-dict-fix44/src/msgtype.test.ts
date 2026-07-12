import { describe, expect, expectTypeOf, it } from 'vitest';
// The generated index declaration-merges the `MsgType` const map with a
// same-name type alias (the union of wire values). Importing it through the
// fixture's bare `export { MsgType }` pins that both sides of the merge
// survive a re-export — the pattern consumers use in their own barrels.
import { MsgType } from './msgtype-reexport.fixture';

describe('MsgType const/type declaration merge', () => {
  it('re-exports the value side', () => {
    expect(MsgType.Logon).toBe('A');
    expect(MsgType.NewOrderSingle).toBe('D');
  });

  it('re-exports the type side as the union of wire values', () => {
    expectTypeOf<MsgType>().toEqualTypeOf<(typeof MsgType)[keyof typeof MsgType]>();
    expectTypeOf<'not-a-msgtype'>().not.toMatchTypeOf<MsgType>();
    // usable in a type position after the re-export
    const logon: MsgType = MsgType.Logon;
    expect(logon).toBe('A');
  });
});
