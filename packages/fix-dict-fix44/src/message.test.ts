import { createFixEngine, type MessageView } from '@boarteam/fix';
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  type EncryptMethod,
  type HeartbeatBody,
  type LogonBody,
  MDEntryType,
  type MDFullGrp_NoMDEntriesEntry,
  type MessageOf,
  MsgType,
  type MarketDataSnapshotFullRefreshBody,
  type MessageBodies,
  dictionary,
  isMessageType,
  message,
} from './index';

// A typed engine over the same dictionary — its `create` is the engine-façade twin of the
// re-exported `message` factory.
const engine = createFixEngine<MessageBodies>(dictionary);

/** Session/header fields supplied at render time (never modelled in the body). */
const ENV = {
  SenderCompID: 'ME',
  TargetCompID: 'YOU',
  MsgSeqNum: 1,
  SendingTime: '20260716-12:00:00',
};
/** The same envelope as raw tags, for the hand-built `encode` oracle. */
const ENV_TAGS = { 49: 'ME', 56: 'YOU', 34: 1, 52: '20260716-12:00:00' };

const show = (s: string) => s.replace(/\x01/g, '|');

describe('typed message → render is byte-identical to encode', () => {
  it('Heartbeat (admin, scalar-only)', () => {
    const wire = message('0').set('TestReqID', 'abc').render(ENV);
    expect(wire).toBe(engine.encode({ msgType: '0', fields: { ...ENV_TAGS, 112: 'abc' } }));
  });

  it('Logon (int-enum, numeric, and Boolean→Y)', () => {
    const wire = message('A')
      .assign({ EncryptMethod: 0, HeartBtInt: 30, ResetSeqNumFlag: true })
      .render(ENV);
    expect(wire).toBe(
      engine.encode({ msgType: 'A', fields: { ...ENV_TAGS, 98: 0, 108: 30, 141: true } }),
    );
    expect(show(wire)).toContain('|98=0|108=30|141=Y|');
  });

  it('MarketDataSnapshotFullRefresh with a repeating group (divergent MDFullGrp variant)', () => {
    const wire = message('W')
      .set('MDReqID', 'r1')
      .set('Symbol', 'AAPL')
      .set('NoMDEntries', [
        { MDEntryType: '0', MDEntryPx: '1.2345' },
        { MDEntryType: '1', MDEntryPx: '1.2346' },
      ])
      .render(ENV);
    expect(wire).toBe(
      engine.encode({
        msgType: 'W',
        fields: { ...ENV_TAGS, 262: 'r1', 55: 'AAPL' },
        groups: {
          268: [{ fields: { 269: '0', 270: '1.2345' } }, { fields: { 269: '1', 270: '1.2346' } }],
        },
      }),
    );
    expect(show(wire)).toContain('|268=2|269=0|270=1.2345|269=1|270=1.2346|');
  });

  it('is byte-accurate for a non-ASCII value (UTF-8 framing)', () => {
    const wire = message('W')
      .set('Symbol', 'Müller')
      .set('NoMDEntries', [{ MDEntryType: '0' }])
      .render(ENV);
    expect(wire).toBe(
      engine.encode({
        msgType: 'W',
        fields: { ...ENV_TAGS, 55: 'Müller' },
        groups: { 268: [{ fields: { 269: '0' } }] },
      }),
    );
  });

  it('passes a MultipleValueString multi-token value through as a string', () => {
    const wire = message('W')
      .set('FinancialStatus', '1 2')
      .set('NoMDEntries', [{ MDEntryType: '0' }])
      .render(ENV);
    expect(wire).toBe(
      engine.encode({
        msgType: 'W',
        fields: { ...ENV_TAGS, 291: '1 2' },
        groups: { 268: [{ fields: { 269: '0' } }] },
      }),
    );
    expect(show(wire)).toContain('|291=1 2|');
  });

  it('engine.create matches the message factory byte-for-byte', () => {
    const a = message('0').set('TestReqID', 'x').render(ENV);
    const b = engine.create('0').set('TestReqID', 'x').render(ENV);
    expect(b).toBe(a);
  });
});

describe('typed message → round-trips through parse', () => {
  it('build W → render → parse recovers the fields and group entries', () => {
    const wire = message('W')
      .set('MDReqID', 'req-9')
      .set('Symbol', 'EURUSD')
      .set('NoMDEntries', [
        { MDEntryType: '0', MDEntryPx: '1.10', MDEntrySize: '1000000' },
        { MDEntryType: '1', MDEntryPx: '1.11', MDEntrySize: '2000000' },
      ])
      .render(ENV);
    const { message: parsed, issues } = engine.parse(wire);
    expect(issues).toEqual([]);
    expect(parsed.msgType).toBe('W');
    expect(parsed.fields[262]!.raw).toBe('req-9');
    expect(parsed.fields[55]!.raw).toBe('EURUSD');
    const entries = parsed.groups[268]!;
    expect(entries.map((e) => e.fields[269]!.raw)).toEqual(['0', '1']);
    expect(entries.map((e) => e.fields[270]!.raw)).toEqual(['1.10', '1.11']);
  });
});

describe('mutable + immutable + bulk construction', () => {
  it('bulk init and assign build the same message as field-by-field', () => {
    const byField = message('A').set('EncryptMethod', 0).set('HeartBtInt', 30).render(ENV);
    const byBulk = message('A', { EncryptMethod: 0, HeartBtInt: 30 }).render(ENV);
    const byAssign = message('A').assign({ EncryptMethod: 0, HeartBtInt: 30 }).render(ENV);
    expect(byBulk).toBe(byField);
    expect(byAssign).toBe(byField);
  });

  it('the immutable builder renders identically and never mutates', () => {
    const base = message.immutable('W').merge({ MDReqID: 'r1' });
    const next = base.with('NoMDEntries', [{ MDEntryType: '0' }]);
    expect(base.has('NoMDEntries')).toBe(false); // original untouched
    expect(next.render(ENV)).toBe(
      message('W')
        .set('MDReqID', 'r1')
        .set('NoMDEntries', [{ MDEntryType: '0' }])
        .render(ENV),
    );
  });

  it('reads fields back as a typed read model (for log metadata)', () => {
    const msg = message('W')
      .set('Symbol', 'AAPL')
      .set('NoMDEntries', [{ MDEntryType: '0', MDEntryPx: '1.5' }]);
    expect(msg.get('Symbol')).toBe('AAPL');
    expect(msg.get('NoMDEntries')?.[0]?.MDEntryPx).toBe('1.5');
    expect(msg.msgType).toBe('W');
  });
});

describe('guard-free init — MessageInit over the generated bodies', () => {
  it('passes possibly-absent values straight through the init', () => {
    const username: string | null | undefined = 'u1';
    const password: string | null | undefined = null;
    const wire = message(MsgType.Logon, {
      EncryptMethod: 0,
      HeartBtInt: 30,
      ResetSeqNumFlag: true,
      Username: username,
      Password: password,
    }).render(ENV);
    expect(wire).toBe(
      engine.encode({
        msgType: 'A',
        fields: { ...ENV_TAGS, 98: 0, 108: 30, 141: true, 553: 'u1' },
      }),
    );
    expect(show(wire)).not.toContain('|554=');
  });

  it("skips '' like undefined/null (an empty FIX value is malformed anyway)", () => {
    const withEmpty = message('A', { EncryptMethod: 0, HeartBtInt: 30, Username: '' }).render(ENV);
    const without = message('A', { EncryptMethod: 0, HeartBtInt: 30 }).render(ENV);
    expect(withEmpty).toBe(without);
  });

  it('requires required keys in a passed init, at top level and inside entries', () => {
    message('A'); // bare create stays lenient for incremental building
    // @ts-expect-error init must name the required EncryptMethod and HeartBtInt
    message(MsgType.Logon, { Username: 'u' });
    // @ts-expect-error a NoMDEntries entry requires MDEntryType
    message('W', { Symbol: 'X', NoMDEntries: [{ MDEntryPx: '1.0' }] });
  });

  it('NoRelatedSym: [] renders no counter tag; typed entry arrays stay assignable', () => {
    const entries: MDFullGrp_NoMDEntriesEntry[] = [
      { MDEntryType: MDEntryType.BID, MDEntryPx: '1.10' },
    ];
    const w = message('W', { Symbol: 'EURUSD', NoMDEntries: entries }).render(ENV);
    expect(show(w)).toContain('|55=EURUSD|268=1|');

    const v = message(MsgType.MarketDataRequest, {
      MDReqID: 'r1',
      SubscriptionRequestType: '1',
      MarketDepth: 1,
      NoMDEntryTypes: [{ MDEntryType: MDEntryType.BID }],
      NoRelatedSym: [],
    }).render(ENV);
    expect(show(v)).toContain('|262=r1|');
    expect(show(v)).not.toContain('|146=');
  });
});

// --- type-level acceptance (enforced by `tsc --noEmit`, which includes test files) ---------

describe('type-level guarantees', () => {
  it('maps field datatypes to the right value types', () => {
    expectTypeOf<HeartbeatBody['TestReqID']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<LogonBody['HeartBtInt']>().toEqualTypeOf<number | string>();
    expectTypeOf<LogonBody['ResetSeqNumFlag']>().toEqualTypeOf<boolean | undefined>();
    // int-based enum widens the wire-string union with `number` (the parsed read-model form)
    expectTypeOf<LogonBody['EncryptMethod']>().toEqualTypeOf<EncryptMethod | number>();
    // char-based enum stays the bare wire-string union
    expectTypeOf<MDFullGrp_NoMDEntriesEntry['MDEntryType']>().toEqualTypeOf<MDEntryType>();
    // MultipleValueString enum falls back to string
    expectTypeOf<MarketDataSnapshotFullRefreshBody['FinancialStatus']>().toEqualTypeOf<
      string | undefined
    >();
  });

  it('types the factory by the MsgType wire value', () => {
    expectTypeOf(MsgType.MarketDataSnapshotFullRefresh).toEqualTypeOf<'W'>();
    const w = message(MsgType.MarketDataSnapshotFullRefresh);
    expectTypeOf(w.get('MDReqID')).toEqualTypeOf<string | undefined>();
    expectTypeOf(w.get('NoMDEntries')).toEqualTypeOf<MDFullGrp_NoMDEntriesEntry[] | undefined>();
  });

  it('rejects illegal fields, wrong value types, and malformed group entries', () => {
    const w = message('W');
    w.set('MDReqID', 'r1'); // ok
    w.set('NoMDEntries', [{ MDEntryType: '0', MDEntryPx: '1.0' }]); // ok
    // @ts-expect-error MDReqID is a string field, not a number
    w.set('MDReqID', 123);
    // @ts-expect-error Symbolz is not a field of MarketDataSnapshotFullRefresh
    w.set('Symbolz', 'x');
    // @ts-expect-error a NoMDEntries entry requires MDEntryType
    w.set('NoMDEntries', [{ MDEntryPx: '1.0' }]);
    // @ts-expect-error 'ZZ' is not a valid MDEntryType code
    w.set('NoMDEntries', [{ MDEntryType: 'ZZ' }]);
  });

  it('enforces required body fields at the body-type level', () => {
    const needsLogon = (b: LogonBody): LogonBody => b;
    needsLogon({ EncryptMethod: 0, HeartBtInt: 30 }); // ok
    // @ts-expect-error LogonBody requires HeartBtInt
    needsLogon({ EncryptMethod: 0 });
    // @ts-expect-error EncryptMethod is required
    needsLogon({ HeartBtInt: 30 });
  });

  it('isMessageType narrows a MessageView<any> so get() is typed to the message body', () => {
    // The consumer boundary: an outgoing message whose concrete MsgType is erased to `any`.
    const msg: MessageView<any> = message('W')
      .set('MDReqID', 'r1')
      .set('Symbol', 'AAPL')
      .set('NoMDEntries', [{ MDEntryType: '0', MDEntryPx: '1.5' }]);
    if (isMessageType(msg, 'W')) {
      // Inside the guard, reads are typed to MarketDataSnapshotFullRefresh — no casts.
      expectTypeOf(msg.get('NoMDEntries')).toEqualTypeOf<
        MDFullGrp_NoMDEntriesEntry[] | undefined
      >();
      expectTypeOf(msg.get('Symbol')).toEqualTypeOf<string | undefined>();
      // @ts-expect-error — NotAField is not part of the W body
      msg.get('NotAField');
      expect(msg.get('Symbol')).toBe('AAPL');
      expect(msg.get('NoMDEntries')?.[0]?.MDEntryPx).toBe('1.5');
    }
    // @ts-expect-error — 'not-a-msgtype' is not a MessageBodies wire value
    isMessageType(msg, 'not-a-msgtype');
  });

  it('isMessageType returns the correct boolean at runtime', () => {
    const w: MessageView<any> = message('W');
    const a: MessageView<any> = message('A');
    expect(isMessageType(w, 'W')).toBe(true);
    expect(isMessageType(w, MsgType.Logon)).toBe(false);
    expect(isMessageType(a, MsgType.Logon)).toBe(true);
  });

  it('MessageOf<M> is the read surface of message M', () => {
    // MessageOf<'W'> is MessageView<MarketDataSnapshotFullRefreshBody> — the `& object` mirrors
    // the constraint the whole typed-message layer applies (a no-op for an object body).
    expectTypeOf<MessageOf<'W'>>().toEqualTypeOf<
      MessageView<MarketDataSnapshotFullRefreshBody & object>
    >();
    const w: MessageOf<'W'> = message('W');
    expectTypeOf(w.get('NoMDEntries')).toEqualTypeOf<MDFullGrp_NoMDEntriesEntry[] | undefined>();
  });
});

describe('perf sanity — real-dictionary market-data hot path', () => {
  it('builds and renders many W snapshots (10 entries each) without pathological cost', () => {
    const N = 3000;
    const t0 = performance.now();
    let bytes = 0;
    for (let i = 0; i < N; i++) {
      const entries = Array.from({ length: 10 }, (_, k) => ({
        // Use the generated enum const so the value stays the literal union, not widened string.
        MDEntryType: k % 2 === 0 ? MDEntryType.BID : MDEntryType.OFFER,
        MDEntryPx: `1.${1000 + k}`,
        MDEntrySize: '1000000',
      }));
      bytes += engine
        .create('W')
        .set('MDReqID', `r${i}`)
        .set('Symbol', 'EURUSD')
        .set('NoMDEntries', entries)
        .render({ SenderCompID: 'ME', TargetCompID: 'YOU', MsgSeqNum: i, SendingTime: 'T' }).length;
    }
    const perMsgMicros = ((performance.now() - t0) * 1000) / N;
    expect(bytes).toBeGreaterThan(0);
    // Smoke test against accidental O(n²)/megamorphic blowups on the real dictionary, not an
    // SLA — a 10-entry snapshot builds + renders well under 50µs on typical local hardware.
    expect(perMsgMicros).toBeLessThan(1000);
  });
});
