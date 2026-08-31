/**
 * The inbound (read) side of the typed message API, over the real FIX 4.4 dictionary and
 * its generated `MessageBodies` — the counterpart of `message.test.ts`, which covers the
 * outbound (build/render) side.
 *
 * The property under test throughout: a body produced by `toInbound` holds exactly the
 * fields the generated `<Msg>Body` type declares, so `inboundTypeGuard<MessageBodies>()`
 * narrowing is sound rather than a cast that happens to work.
 */
import {
  createFixEngine,
  inboundKnownGuard,
  inboundTypeGuard,
  loadDictionary,
  parse,
  toInbound,
} from '@boarteam/fix';
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  MDEntryType,
  type MDFullGrp_NoMDEntriesEntry,
  type MessageBodies,
  MsgType,
  dictionary,
} from './index';

// The consumer-side binding the docs describe: the dict package ships `MessageBodies`, the
// guard is bound to it once, here.
const isInboundType = inboundTypeGuard<MessageBodies>();
const dict = loadDictionary(dictionary);
const wire = (s: string) => s.replace(/\|/g, '\x01');
const read = (s: string) => toInbound(parse(wire(s), dict, { checkFraming: false }).message, dict);

const LOGON =
  '8=FIX.4.4|9=0|35=A|49=CLIENT|56=SERVER|34=12|52=20260817-09:30:00|43=Y|98=0|108=30|10=000|';
const SNAPSHOT =
  '8=FIX.4.4|9=0|35=W|49=CLIENT|56=SERVER|34=13|52=20260817-09:30:01|262=req-1|55=EURUSD|' +
  '48=1|22=8|268=2|269=0|270=1.10100|271=1000000|269=1|270=1.10120|271=2000000|10=000|';

describe('envelope — the standard header and trailer, by name', () => {
  it('splits the real FIX 4.4 header off the body', () => {
    const msg = read(LOGON);

    expect(msg.envelope.SenderCompID).toBe('CLIENT');
    expect(msg.envelope.TargetCompID).toBe('SERVER');
    expect(msg.envelope.MsgSeqNum).toBe(12);
    expect(msg.envelope.SendingTime).toBe('20260817-09:30:00');
    // PossDupFlag(43) is ENUMERATED in FIX 4.4, and an enumerated value is decoded
    // opaquely — so it reads as the wire code, not a coerced boolean.
    expect(msg.envelope.PossDupFlag).toBe('Y');

    // …and none of it leaks into the body, which is what makes the generated body types
    // (which exclude the envelope by construction) a truthful description of it.
    expect(msg.toJSON()).toEqual({ EncryptMethod: '0', HeartBtInt: 30 });
  });

  it('includes fields reachable through the header’s own nested group', () => {
    // NoHops(627) sits inside StandardHeader; its members are envelope tags too, so they
    // must not surface as a body group on the message that carried them.
    const msg = read(
      '8=FIX.4.4|9=0|35=0|49=C|56=S|34=1|52=T|627=1|628=HOP_A|629=20260817-09:00:00|10=000|',
    );
    expect(dict.fieldByTag(628)?.name).toBe('HopCompID');
    expect(msg.toJSON()).toEqual({});
    expect(msg.envelope.NoHops).toEqual([
      { HopCompID: 'HOP_A', HopSendingTime: '20260817-09:00:00' },
    ]);
  });
});

describe('narrowing with the generated MessageBodies', () => {
  it('types body reads on a MarketDataSnapshotFullRefresh', () => {
    const msg = read(SNAPSHOT);

    if (isInboundType(msg, MsgType.MarketDataSnapshotFullRefresh)) {
      expectTypeOf(msg.get('Symbol')).toEqualTypeOf<string | undefined>();
      expectTypeOf(msg.get('MDReqID')).toEqualTypeOf<string | undefined>();
      expectTypeOf(msg.get('NoMDEntries')).toEqualTypeOf<
        MDFullGrp_NoMDEntriesEntry[] | undefined
      >();

      expect(msg.get('MDReqID')).toBe('req-1');
      expect(msg.get('Symbol')).toBe('EURUSD');
      expect(msg.get('SecurityID')).toBe('1');
      expect(msg.get('NoMDEntries')).toHaveLength(2);
      // Enumerated char: kept verbatim, so it compares against the generated enum.
      expect(msg.get('NoMDEntries')?.[0]?.MDEntryType).toBe(MDEntryType.BID);
      // The envelope survives the narrowing — the reason this guard is not `isMessageType`.
      expect(msg.envelope.MsgSeqNum).toBe(13);
    } else {
      expect.unreachable('W should have narrowed');
    }
  });

  it('does not narrow on a msgType mismatch', () => {
    const msg = read(LOGON);
    expect(isInboundType(msg, MsgType.MarketDataSnapshotFullRefresh)).toBe(false);
    expect(isInboundType(msg, MsgType.Logon)).toBe(true);
  });

  it('reads a SecurityList’s NoRelatedSym as typed entries', () => {
    const msg = read(
      '8=FIX.4.4|9=0|35=y|49=C|56=S|34=2|52=T|320=r1|322=resp1|560=0|393=2|893=Y|' +
        '146=2|55=EURUSD|48=1|22=8|55=GBPUSD|48=2|22=8|10=000|',
    );
    if (isInboundType(msg, MsgType.SecurityList)) {
      expect(msg.get('SecurityReqID')).toBe('r1');
      expect(msg.get('TotNoRelatedSym')).toBe(2);
      expect(msg.get('NoRelatedSym')?.map((e) => e.Symbol)).toEqual(['EURUSD', 'GBPUSD']);
    } else {
      expect.unreachable('y should have narrowed');
    }
  });
});

describe('the shape of a read value', () => {
  it('carries the decoded value, and the raw one on `parsed`', () => {
    const msg = read(SNAPSHOT);
    const entry = msg.parsed.groups[268]?.[0];
    // float → number for arithmetic, with the wire form kept for byte-faithful re-encode.
    expect(entry?.fields[270]?.value).toBe(1.101);
    expect(entry?.fields[270]?.raw).toBe('1.10100');
  });

  it('is typed by the generated body, which is init-shaped (`number | string`)', () => {
    // Documented consequence, not an accident: the generated bodies widen numerics for the
    // BUILD side (`message().set('MDEntryPx', '1.101')` is legal). A reader gets that union
    // back and narrows it. Tightening `B` to the read shape and moving the widening into
    // `MessageInit` is a codegen change, tracked separately.
    const msg = read(SNAPSHOT);
    if (isInboundType(msg, MsgType.MarketDataSnapshotFullRefresh)) {
      expectTypeOf(msg.get('NoMDEntries')?.[0]?.MDEntryPx).toEqualTypeOf<
        number | string | undefined
      >();
      expect(msg.get('NoMDEntries')?.[0]?.MDEntryPx).toBe(1.101);
    }
  });
});

describe('engine façade over the real dictionary', () => {
  it('parses, gates on issues, then reads', () => {
    const fix = createFixEngine<MessageBodies>(dictionary);
    const { message, issues } = fix.parse(wire(SNAPSHOT), { checkFraming: false });
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);

    const inbound = fix.inbound(message);
    expect(inbound.envelope.SenderCompID).toBe('CLIENT');
    if (fix.isInbound(inbound, MsgType.MarketDataSnapshotFullRefresh)) {
      expect(inbound.get('NoMDEntries')?.[1]?.MDEntrySize).toBe(2000000);
    } else {
      expect.unreachable('W should have narrowed');
    }
  });
});

describe('InboundUnion at full FIX 4.4 scale', () => {
  // 93 messages in one discriminated union — the case that decides whether `switch`
  // dispatch is practical on a real dictionary rather than a hand-picked subset.
  const isKnownInbound = inboundKnownGuard<MessageBodies>(dict);

  it('narrows a switch over the whole dictionary, per message body', () => {
    const dispatch = (msg: ReturnType<typeof read>): string => {
      if (!isKnownInbound(msg)) {
        return `unknown:${msg.msgType}`;
      }
      switch (msg.msgType) {
        case MsgType.Logon:
          expectTypeOf(msg.get('HeartBtInt')).toEqualTypeOf<number | string | undefined>();
          return `logon:${msg.get('HeartBtInt')}`;
        case MsgType.MarketDataSnapshotFullRefresh:
          expectTypeOf(msg.get('NoMDEntries')).toEqualTypeOf<
            MDFullGrp_NoMDEntriesEntry[] | undefined
          >();
          return `snapshot:${msg.get('Symbol')}:${msg.get('NoMDEntries')?.length}`;
        case MsgType.SecurityList:
          return `list:${msg.get('NoRelatedSym')?.length}`;
        default:
          // 90 members remain, so this is a live branch, not `never` — "known, not ours".
          return `unhandled:${msg.msgType}`;
      }
    };

    expect(dispatch(read(LOGON))).toBe('logon:30');
    expect(dispatch(read(SNAPSHOT))).toBe('snapshot:EURUSD:2');
    expect(dispatch(read('8=FIX.4.4|9=0|35=0|49=C|56=S|34=1|52=T|112=t1|10=000|'))).toBe(
      'unhandled:0',
    );
    expect(dispatch(read('8=FIX.4.4|9=0|35=ZZ|49=C|56=S|34=1|52=T|10=000|'))).toBe('unknown:ZZ');
  });

  it('accepts every MsgType the dictionary defines, and only those', () => {
    expect(isKnownInbound(read(SNAPSHOT))).toBe(true);
    // Every assigned code passes, including the two-character ones — 'BB' is
    // CollateralInquiry, not a gap.
    expect(isKnownInbound(read('8=FIX.4.4|9=0|35=BB|49=C|56=S|34=1|52=T|10=000|'))).toBe(true);
    // 'ZZ' is unassigned in FIX 4.4.
    expect(isKnownInbound(read('8=FIX.4.4|9=0|35=ZZ|49=C|56=S|34=1|52=T|10=000|'))).toBe(false);
  });
});
