import { describe, expect, expectTypeOf, it } from 'vitest';
import { parse } from './codec/parse';
import { SOH } from './codec/tokenize';
import { createFixEngine } from './engine';
import {
  type InboundBody,
  type InboundMessage,
  type InboundOf,
  type InboundUnion,
  inboundKnownGuard,
  inboundTypeGuard,
  toInbound,
} from './inbound';

import { type MDSnapshotBody, type TinyBodies, dict, tinyDict } from './tiny-dict.fixture';

const wire = (s: string) => s.replace(/\|/g, SOH);
const read = (s: string) => toInbound(parse(wire(s), dict, { checkFraming: false }).message, dict);

const LOGON =
  '8=FIX.4.4|9=0|35=A|49=CLIENT|56=SERVER|34=7|52=20260817-12:00:00|98=0|108=30|10=000|';
const SNAPSHOT =
  '8=FIX.4.4|9=0|35=W|49=CLIENT|56=SERVER|34=8|52=20260817-12:00:01|55=EURUSD|' +
  '268=2|269=0|270=1.1010|453=1|448=PARTY_A|269=1|270=1.1012|58=note|10=000|';

describe('toInbound — envelope/body split', () => {
  it('routes header and trailer tags to the envelope, body tags to the body', () => {
    const msg = read(LOGON);

    expect(msg.msgType).toBe('A');
    expect(msg.envelope.SenderCompID).toBe('CLIENT');
    expect(msg.envelope.TargetCompID).toBe('SERVER');
    expect(msg.envelope.SendingTime).toBe('20260817-12:00:00');
    // Framing fields belong to the header/trailer components, so they land here too.
    expect(msg.envelope.BeginString).toBe('FIX.4.4');
    expect(msg.envelope.MsgType).toBe('A');
    expect(msg.envelope.CheckSum).toBe('000');

    expect(msg.toJSON()).toEqual({ EncryptMethod: 0, HeartBtInt: 30 });
  });

  it('coerces envelope values by datatype, not to strings', () => {
    // MsgSeqNum is `int` in the dictionary: the whole point of reading a typed envelope
    // rather than the raw wire value is that a session can compare it numerically.
    expect(read(LOGON).envelope.MsgSeqNum).toBe(7);
    expect(typeof read(LOGON).envelope.MsgSeqNum).toBe('number');
  });

  it('leaves the body free of every envelope field', () => {
    const body = read(LOGON).toJSON() as Record<string, unknown>;
    for (const name of [
      'BeginString',
      'BodyLength',
      'MsgType',
      'MsgSeqNum',
      'SenderCompID',
      'TargetCompID',
      'SendingTime',
      'CheckSum',
    ]) {
      expect(body).not.toHaveProperty(name);
    }
  });
});

describe('toInbound — repeating groups', () => {
  it('keys groups by counter name as arrays of entry objects', () => {
    const msg = read(SNAPSHOT);
    expect(msg.get('Symbol')).toBe('EURUSD');
    expect(msg.get('Text')).toBe('note');
    expect(msg.get('NoMDEntries')).toEqual([
      { MDEntryType: '0', MDEntryPx: '1.1010', NoPartyIDs: [{ PartyID: 'PARTY_A' }] },
      { MDEntryType: '1', MDEntryPx: '1.1012' },
    ]);
  });

  it('nests a group inside an entry the same way as at the top level', () => {
    // The other way in: the MsgType is known at the call site, so name the body directly
    // instead of narrowing.
    const msg = toInbound<MDSnapshotBody>(
      parse(wire(SNAPSHOT), dict, { checkFraming: false }).message,
      dict,
    );
    const entries = msg.get('NoMDEntries')!;
    expect(entries[0]!.NoPartyIDs).toEqual([{ PartyID: 'PARTY_A' }]);
    // Entry 2 has no nested group at all — absent, not an empty array.
    expect(entries[1]).not.toHaveProperty('NoPartyIDs');
  });

  it('reads a declared-but-empty group as an empty array', () => {
    const msg = read('8=FIX.4.4|9=0|35=W|49=C|56=S|34=1|52=T|55=EURUSD|268=0|10=000|');
    expect(msg.get('NoMDEntries')).toEqual([]);
  });

  it('does not confuse the group counter with a scalar body field', () => {
    // `NoMDEntries` is the array, never the count 2 — the entries are the truth.
    expect(read(SNAPSHOT).get('NoMDEntries')).toHaveLength(2);
  });
});

describe('toInbound — what it deliberately does not carry', () => {
  it('keeps a tag unknown to the dictionary out of the body, but reachable on `parsed`', () => {
    const raw = wire('8=FIX.4.4|9=0|35=A|49=C|56=S|34=1|52=T|98=0|108=30|9999=surprise|10=000|');
    const { message, issues } = parse(raw, dict, { checkFraming: false });
    const msg = toInbound(message, dict);

    // parse already said so; toInbound does not re-report or throw.
    expect(issues.map((i) => i.code)).toContain('parse/unknown-tag');
    expect(Object.keys(msg.toJSON())).toEqual(['EncryptMethod', 'HeartBtInt']);
    expect(msg.parsed.fields[9999]?.raw).toBe('surprise');
  });

  it('never throws on a message the dictionary cannot structure', () => {
    // Unknown MsgType: parse falls back to flat, so there are no groups to re-key. The
    // envelope split still works — header tags are dictionary-level, not message-level.
    const msg = read('8=FIX.4.4|9=0|35=ZZ|49=C|56=S|34=3|52=T|55=EURUSD|10=000|');
    expect(msg.msgType).toBe('ZZ');
    expect(msg.envelope.MsgSeqNum).toBe(3);
    expect(msg.get('Symbol')).toBe('EURUSD');
  });
});

describe('toInbound — it is a MessageView', () => {
  it('renders the received body back out with a fresh envelope', () => {
    const rendered = read(SNAPSHOT).render({
      SenderCompID: 'SERVER',
      TargetCompID: 'CLIENT',
      MsgSeqNum: 99,
      SendingTime: '20260817-12:00:02',
    });
    expect(rendered).toContain(wire('55=EURUSD|'));
    expect(rendered).toContain(wire('268=2|'));
    expect(rendered).toContain(wire('448=PARTY_A|'));
    expect(rendered).toContain(wire('34=99|'));
    // The body is what was received; the envelope is the caller's.
    expect(rendered).not.toContain(wire('34=8|'));
  });

  it('exposes the tag-keyed original for byte-faithful re-encoding', () => {
    const msg = read(SNAPSHOT);
    expect(msg.parsed.fields[270]).toBeUndefined(); // 270 lives inside the group
    expect(msg.parsed.groups[268]?.[0]?.fields[270]?.raw).toBe('1.1010');
  });
});

describe('inboundTypeGuard', () => {
  const isInboundType = inboundTypeGuard<TinyBodies>();

  it('narrows on a msgType match and types the body reads', () => {
    const msg = read(SNAPSHOT);
    expect(isInboundType(msg, 'A')).toBe(false);

    if (isInboundType(msg, 'W')) {
      expectTypeOf(msg.get('Symbol')).toEqualTypeOf<string | undefined>();
      expectTypeOf(msg.get('NoMDEntries')).toEqualTypeOf<
        MDSnapshotBody['NoMDEntries'] | undefined
      >();
      expect(msg.get('NoMDEntries')?.[0]?.MDEntryPx).toBe('1.1010');
    } else {
      expect.unreachable('W should have narrowed');
    }
  });

  it('types the loose path when a caller opts into InboundBody instead of narrowing', () => {
    const msg = toInbound<InboundBody>(
      parse(wire(SNAPSHOT), dict, { checkFraming: false }).message,
      dict,
    );
    expectTypeOf(msg.get('Symbol')).toEqualTypeOf<InboundBody[string] | undefined>();
    expect(msg.get('Symbol')).toBe('EURUSD');
  });

  it('keeps the envelope reachable after narrowing', () => {
    // The reason this guard exists rather than reusing `messageTypeGuard`: narrowing to a
    // plain MessageView would drop `envelope`/`parsed`, and a session needs MsgSeqNum
    // exactly where it reads the body.
    const msg = read(SNAPSHOT);
    if (isInboundType(msg, 'W')) {
      expectTypeOf(msg).toEqualTypeOf<InboundOf<TinyBodies, 'W'>>();
      expect(msg.envelope.MsgSeqNum).toBe(8);
      expect(msg.parsed.msgType).toBe('W');
    }
  });
});

describe('engine façade', () => {
  it('exposes inbound() and isInbound over the bound dictionary', () => {
    const fix = createFixEngine<TinyBodies>(tinyDict());
    const { message } = fix.parse(wire(SNAPSHOT), { checkFraming: false });
    const inbound = fix.inbound(message);

    expect(inbound.envelope.MsgSeqNum).toBe(8);
    if (fix.isInbound(inbound, 'W')) {
      expect(inbound.get('NoMDEntries')).toHaveLength(2);
    } else {
      expect.unreachable('W should have narrowed');
    }
  });
});

describe('InboundUnion — switch dispatch', () => {
  const isKnownInbound = inboundKnownGuard<TinyBodies>(dict);

  /** What a consumer's dispatcher looks like: guard once, then switch. */
  const describeMessage = (msg: InboundMessage<InboundBody>): string => {
    if (!isKnownInbound(msg)) {
      return `unknown:${msg.msgType}`;
    }
    switch (msg.msgType) {
      case 'A':
        // Typed to LogonBody here — and `msgType` is the literal, not `string`.
        expectTypeOf(msg.msgType).toEqualTypeOf<'A'>();
        return `logon:${msg.get('HeartBtInt')}`;
      case 'W':
        expectTypeOf(msg.get('Symbol')).toEqualTypeOf<string | undefined>();
        return `snapshot:${msg.get('Symbol')}:${msg.get('NoMDEntries')?.length}`;
      default: {
        // Every member handled, so this is `never` — exhaustiveness, checked by the compiler.
        const exhaustive: never = msg;
        return String(exhaustive);
      }
    }
  };

  it('narrows each case to that message’s body', () => {
    expect(describeMessage(read(LOGON))).toBe('logon:30');
    expect(describeMessage(read(SNAPSHOT))).toBe('snapshot:EURUSD:2');
  });

  it('routes a MsgType the dictionary does not know away from the switch', () => {
    // It could not be a union member: a `msgType: string` member overlaps every literal and
    // would make `get()` uncallable in every branch. It also parses flat, with no groups.
    expect(describeMessage(read('8=FIX.4.4|9=0|35=ZZ|49=C|56=S|34=1|52=T|10=000|'))).toBe(
      'unknown:ZZ',
    );
  });

  it('leaves `default` live and typed when only some messages are handled', () => {
    // The api case: a consumer handling a subset wants `default` to mean "known, not ours"
    // rather than `never`.
    const handled = (msg: InboundUnion<TinyBodies>): string => {
      switch (msg.msgType) {
        case 'W':
          return msg.get('Symbol') ?? '';
        default:
          // Still a real message here, not `never`.
          expectTypeOf(msg).toEqualTypeOf<InboundOf<TinyBodies, 'A'>>();
          return `unhandled:${msg.msgType}`;
      }
    };
    const logon = read(LOGON);
    expect(isKnownInbound(logon) && handled(logon)).toBe('unhandled:A');
  });

  it('reads msgType and envelope before the switch, body only inside it', () => {
    const msg = read(SNAPSHOT);
    if (isKnownInbound(msg)) {
      // Same type in every member, so these are callable un-narrowed.
      expect(msg.msgType).toBe('W');
      expect(msg.envelope.MsgSeqNum).toBe(8);
      // @ts-expect-error `get` differs per member; the union is not callable until narrowed.
      msg.get('Symbol');
    }
  });

  it('is bound by the engine as isKnown', () => {
    const fix = createFixEngine<TinyBodies>(tinyDict());
    const msg = fix.inbound(fix.parse(wire(SNAPSHOT), { checkFraming: false }).message);
    expect(fix.isKnown(msg)).toBe(true);
    const unknown = fix.inbound(
      fix.parse(wire('8=FIX.4.4|9=0|35=ZZ|49=C|56=S|34=1|52=T|10=000|'), {
        checkFraming: false,
      }).message,
    );
    expect(fix.isKnown(unknown)).toBe(false);
  });
});
