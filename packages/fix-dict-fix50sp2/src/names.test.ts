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

  it('resolves well-known tags, including the FIXT session fields', () => {
    expect(TagNames[8]).toBe('BeginString');
    expect(TagNames[35]).toBe('MsgType');
    expect(TagNames[55]).toBe('Symbol');
    // The FIXT-era fields the fix44 dictionary asserts ABSENT are present here.
    expect(TagNames[1128]).toBe('ApplVerID');
    expect(TagNames[1137]).toBe('DefaultApplVerID');
    expect(TagNames[1156]).toBe('ApplExtID');
  });

  it('returns undefined for tags outside the dictionary', () => {
    expect(TagNames[99999]).toBeUndefined();
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

  it('resolves well-known message types across both layers', () => {
    expect(MsgTypeNames['A']).toBe('Logon'); // FIXT session layer
    expect(MsgTypeNames['W']).toBe('MarketDataSnapshotFullRefresh');
    expect(MsgTypeNames['D']).toBe('NewOrderSingle');
    expect(MsgTypeNames['j']).toBe('BusinessMessageReject'); // app-layer reject
    expect(MsgTypeNames['CA']).toBe('OrderMassActionRequest'); // an SP2 addition
  });

  it('returns undefined for unknown values, including unshipped XMLnonFIX(n)', () => {
    expect(MsgTypeNames['ZZ']).toBeUndefined();
    expect(MsgTypeNames['n']).toBeUndefined();
  });
});
