import { createFixEngine, type MessageView } from '@boarteam/fix';
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  type LogonBody,
  MDEntryType,
  type MarketDataSnapshotFullRefreshBody,
  type MDFullGrp_NoMDEntriesEntry,
  type MessageOf,
  MsgType,
  type MessageBodies,
  dictionary,
  Enums,
  isMessageType,
  message,
} from './index';

// Smoke coverage for the generated typed-message surface on FIX 5.0 SP2 over FIXT.1.1 —
// the FIXT-specific DX moments: a typed Logon whose body REQUIRES DefaultApplVerID(1137),
// and app messages rendering under the `8=FIXT.1.1` envelope. The runtime is the shared
// `@boarteam/fix` code exercised in depth by the fix44 suite; here we confirm it renders
// byte-identically over the fix50sp2 dictionary + types.

const engine = createFixEngine<MessageBodies>(dictionary);
const ENV = {
  SenderCompID: 'ME',
  TargetCompID: 'YOU',
  MsgSeqNum: 1,
  SendingTime: '20260801-12:00:00',
};
const ENV_TAGS = { 49: 'ME', 56: 'YOU', 34: 1, 52: '20260801-12:00:00' };
const show = (s: string) => s.replace(/\x01/g, '|');

describe('FIX 5.0 SP2 typed message → render is byte-identical to encode', () => {
  it('Logon with the required DefaultApplVerID (the flagship FIXT case)', () => {
    const wire = message('A')
      .assign({ EncryptMethod: 0, HeartBtInt: 30, DefaultApplVerID: Enums.ApplVerID.FIX50SP2 })
      .render(ENV);
    expect(wire).toBe(
      engine.encode({ msgType: 'A', fields: { ...ENV_TAGS, 98: 0, 108: 30, 1137: '9' } }),
    );
    expect(wire.startsWith('8=FIXT.1.1\x01')).toBe(true);
    expect(show(wire)).toContain('|1137=9|');
  });

  it('Heartbeat (scalar-only)', () => {
    const wire = message('0').set('TestReqID', 'abc').render(ENV);
    expect(wire).toBe(engine.encode({ msgType: '0', fields: { ...ENV_TAGS, 112: 'abc' } }));
  });

  it('MarketDataSnapshotFullRefresh with the MDFullGrp repeating group', () => {
    const wire = message('W')
      .set('Symbol', 'EUR/USD')
      .set('MDReqID', 'r1')
      .set('NoMDEntries', [
        { MDEntryType: MDEntryType.BID, MDEntryPx: '1.1050' },
        { MDEntryType: MDEntryType.OFFER, MDEntryPx: '1.1052' },
      ])
      .render(ENV);
    expect(wire).toBe(
      engine.encode({
        msgType: 'W',
        fields: { ...ENV_TAGS, 262: 'r1', 55: 'EUR/USD' },
        groups: {
          268: [{ fields: { 269: '0', 270: '1.1050' } }, { fields: { 269: '1', 270: '1.1052' } }],
        },
      }),
    );
    expect(show(wire)).toContain('|268=2|269=0|270=1.1050|269=1|270=1.1052|');
  });

  it('a per-message ApplVerID(1128) override rides in the envelope', () => {
    const wire = message('0').render({ ...ENV, ApplVerID: Enums.ApplVerID.FIX50SP2 });
    expect(wire).toBe(engine.encode({ msgType: '0', fields: { ...ENV_TAGS, 1128: '9' } }));
    expect(show(wire)).toContain('|1128=9|');
  });

  it('round-trips build → render → parse', () => {
    const wire = message('W')
      .set('Symbol', 'GBP/USD')
      .set('NoMDEntries', [{ MDEntryType: MDEntryType.TRADE, MDEntryPx: '1.27' }])
      .render(ENV);
    const { message: parsed, issues } = engine.parse(wire);
    expect(issues).toEqual([]);
    expect(parsed.beginString).toBe('FIXT.1.1');
    expect(parsed.msgType).toBe('W');
    expect(parsed.fields[55]!.raw).toBe('GBP/USD');
    expect(parsed.groups[268]![0]!.fields[269]!.raw).toBe('2');
  });
});

describe('FIX 5.0 SP2 type-level guarantees', () => {
  it('types the factory by the MsgType wire value and the group entry', () => {
    expectTypeOf(MsgType.MarketDataSnapshotFullRefresh).toEqualTypeOf<'W'>();
    expectTypeOf(message('W').get('NoMDEntries')).toEqualTypeOf<
      MDFullGrp_NoMDEntriesEntry[] | undefined
    >();
    const needsLogon = (b: LogonBody): LogonBody => b;
    needsLogon({ EncryptMethod: '0', HeartBtInt: 30, DefaultApplVerID: '9' });
    // @ts-expect-error — a FIXT LogonBody REQUIRES DefaultApplVerID(1137)
    needsLogon({ EncryptMethod: '0', HeartBtInt: 30 });
    // @ts-expect-error a NoMDEntries entry requires MDEntryType
    message('W').set('NoMDEntries', [{ MDEntryPx: '1.0' }]);
  });

  it('isMessageType narrows an unknown message; MessageOf is the read surface', () => {
    const msg: MessageView<any> = message('W')
      .set('Symbol', 'EUR/USD')
      .set('NoMDEntries', [{ MDEntryType: MDEntryType.BID, MDEntryPx: '1.1050' }]);
    // Pin the positive case outside the `if` — otherwise a guard that wrongly returned false
    // would skip the block below and this test would pass vacuously.
    expect(isMessageType(msg, 'W')).toBe(true);
    if (isMessageType(msg, 'W')) {
      expectTypeOf(msg.get('NoMDEntries')).toEqualTypeOf<
        MDFullGrp_NoMDEntriesEntry[] | undefined
      >();
      // @ts-expect-error — NotAField is not part of the W body
      msg.get('NotAField');
      expect(msg.get('Symbol')).toBe('EUR/USD');
    }
    expect(isMessageType(msg, MsgType.Logon)).toBe(false);
    // @ts-expect-error — 'not-a-msgtype' is not a MessageBodies wire value
    isMessageType(msg, 'not-a-msgtype');
    expectTypeOf<MessageOf<'W'>>().toEqualTypeOf<
      MessageView<MarketDataSnapshotFullRefreshBody & object>
    >();
  });
});
