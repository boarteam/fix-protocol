import { createFixEngine, type MessageView } from '@boarteam/fix';
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  type LogonBody,
  MDEntryType,
  type MarketDataSnapshotFullRefreshBody,
  type MarketDataSnapshotFullRefresh_NoMDEntriesEntry,
  type MessageOf,
  MsgType,
  type MessageBodies,
  dictionary,
  isMessageType,
  message,
} from './index';

// Smoke coverage for the generated typed-message surface on FIX 4.2 — structurally distinct
// from FIX 4.4 (only 2 components, and the market-data group is defined directly on the
// message, so its entry is `MarketDataSnapshotFullRefresh_NoMDEntriesEntry`, not behind a
// component). The runtime is the shared `@boarteam/fix` code exercised in depth by the fix44
// suite; here we confirm it renders byte-identically over the fix42 dictionary + types.

const engine = createFixEngine<MessageBodies>(dictionary);
const ENV = {
  SenderCompID: 'ME',
  TargetCompID: 'YOU',
  MsgSeqNum: 1,
  SendingTime: '20260716-12:00:00',
};
const ENV_TAGS = { 49: 'ME', 56: 'YOU', 34: 1, 52: '20260716-12:00:00' };
const show = (s: string) => s.replace(/\x01/g, '|');

describe('FIX 4.2 typed message → render is byte-identical to encode', () => {
  it('Heartbeat (scalar-only)', () => {
    const wire = message('0').set('TestReqID', 'abc').render(ENV);
    expect(wire).toBe(engine.encode({ msgType: '0', fields: { ...ENV_TAGS, 112: 'abc' } }));
  });

  it('Logon (int-enum + numeric)', () => {
    const wire = message('A').assign({ EncryptMethod: 0, HeartBtInt: 30 }).render(ENV);
    expect(wire).toBe(engine.encode({ msgType: 'A', fields: { ...ENV_TAGS, 98: 0, 108: 30 } }));
  });

  it('MarketDataSnapshotFullRefresh with a message-direct repeating group', () => {
    const wire = message('W')
      .set('Symbol', 'EUR/USD')
      .set('MDReqID', 'r1')
      .set('NoMDEntries', [
        { MDEntryType: MDEntryType.Bid, MDEntryPx: '1.1050' },
        { MDEntryType: MDEntryType.Offer, MDEntryPx: '1.1052' },
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

  it('round-trips build → render → parse', () => {
    const wire = message('W')
      .set('Symbol', 'GBP/USD')
      .set('NoMDEntries', [{ MDEntryType: MDEntryType.Trade, MDEntryPx: '1.27' }])
      .render(ENV);
    const { message: parsed, issues } = engine.parse(wire);
    expect(issues).toEqual([]);
    expect(parsed.msgType).toBe('W');
    expect(parsed.fields[55]!.raw).toBe('GBP/USD');
    expect(parsed.groups[268]![0]!.fields[269]!.raw).toBe('2');
  });
});

describe('FIX 4.2 type-level guarantees', () => {
  it('types the factory by the MsgType wire value and the group entry', () => {
    expectTypeOf(MsgType.MarketDataSnapshotFullRefresh).toEqualTypeOf<'W'>();
    expectTypeOf(message('W').get('NoMDEntries')).toEqualTypeOf<
      MarketDataSnapshotFullRefresh_NoMDEntriesEntry[] | undefined
    >();
    // Symbol is required in the FIX 4.2 body; EncryptMethod required in Logon.
    const needsLogon = (b: LogonBody): LogonBody => b;
    needsLogon({ EncryptMethod: 0, HeartBtInt: 30 });
    // @ts-expect-error a NoMDEntries entry requires MDEntryType
    message('W').set('NoMDEntries', [{ MDEntryPx: '1.0' }]);
  });

  it('isMessageType narrows an unknown message; MessageOf is the read surface', () => {
    const msg: MessageView<any> = message('W')
      .set('Symbol', 'EUR/USD')
      .set('NoMDEntries', [{ MDEntryType: MDEntryType.Bid, MDEntryPx: '1.1050' }]);
    // Pin the positive case outside the `if` — otherwise a guard that wrongly returned false
    // would skip the block below and this test would pass vacuously.
    expect(isMessageType(msg, 'W')).toBe(true);
    if (isMessageType(msg, 'W')) {
      expectTypeOf(msg.get('NoMDEntries')).toEqualTypeOf<
        MarketDataSnapshotFullRefresh_NoMDEntriesEntry[] | undefined
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
