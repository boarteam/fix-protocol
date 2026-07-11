import { describe, expect, it } from 'vitest';
// TagNames/MsgTypeNames are emitted by @boarteam/fix-codegen alongside
// Tags/MsgType; these tests pin that the pairs stay exact inverses.
import { MsgType, MsgTypeNames, TagNames, Tags } from './index';

describe('TagNames', () => {
  it('inverts every Tags entry (bijection)', () => {
    const names = Object.keys(Tags) as (keyof typeof Tags)[];
    expect(Object.keys(TagNames)).toHaveLength(names.length);
    for (const name of names) {
      expect(TagNames[Tags[name]]).toBe(name);
    }
  });

  it('resolves well-known tags', () => {
    expect(TagNames[8]).toBe('BeginString');
    expect(TagNames[35]).toBe('MsgType');
    expect(TagNames[55]).toBe('Symbol');
    expect(TagNames[58]).toBe('Text');
  });

  it('returns undefined for tags outside the dictionary', () => {
    expect(TagNames[99999]).toBeUndefined();
    expect(TagNames[711]).toBeUndefined(); // NoUnderlyings is FIX 4.4+
  });
});

describe('MsgTypeNames', () => {
  it('inverts every MsgType entry (bijection)', () => {
    const names = Object.keys(MsgType) as (keyof typeof MsgType)[];
    expect(Object.keys(MsgTypeNames)).toHaveLength(names.length);
    for (const name of names) {
      expect(MsgTypeNames[MsgType[name]]).toBe(name);
    }
  });

  it('resolves well-known message types', () => {
    expect(MsgTypeNames['A']).toBe('Logon');
    expect(MsgTypeNames['W']).toBe('MarketDataSnapshotFullRefresh');
    // The FIX Repository 2010 Edition names msgtype D "OrderSingle" in 4.2
    // (the "New" prefix is FIX 4.4 naming).
    expect(MsgTypeNames['D']).toBe('OrderSingle');
  });

  it('returns undefined for unknown values', () => {
    expect(MsgTypeNames['ZZ']).toBeUndefined();
  });
});
