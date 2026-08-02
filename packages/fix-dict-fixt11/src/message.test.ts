import { createFixEngine } from '@boarteam/fix';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { type LogonBody, type MessageBodies, dictionary, Enums, message } from './index';

// The FIXT transport dictionary's flagship DX moment: a typed Logon whose body REQUIRES
// DefaultApplVerID(1137), rendering under the FIXT.1.1 envelope — plus one full
// encode→parse→validate round-trip over the session layer.

const engine = createFixEngine<MessageBodies>(dictionary);
const ENV = {
  SenderCompID: 'INITIATOR',
  TargetCompID: 'ACCEPTOR',
  MsgSeqNum: 1,
  SendingTime: '20260801-12:00:00',
};

describe('FIXT.1.1 Logon round-trip', () => {
  it('builds, renders, parses, and validates a Logon with DefaultApplVerID=9', () => {
    const wire = message('A')
      .assign({
        EncryptMethod: '0',
        HeartBtInt: 30,
        DefaultApplVerID: Enums.ApplVerID.FIX50SP2, // '9'
      })
      .render(ENV);

    expect(wire.startsWith('8=FIXT.1.1\x01')).toBe(true);
    expect(wire).toBe(
      engine.encode({
        msgType: 'A',
        fields: {
          49: 'INITIATOR',
          56: 'ACCEPTOR',
          34: 1,
          52: '20260801-12:00:00',
          98: '0',
          108: 30,
          1137: '9',
        },
      }),
    );

    const { message: parsed, issues } = engine.parse(wire);
    expect(issues).toEqual([]);
    expect(parsed.name).toBe('Logon');
    expect(parsed.beginString).toBe('FIXT.1.1');
    expect(parsed.fields[1137]!.raw).toBe('9');
    expect(engine.validate(parsed).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('validate flags a Logon missing the required DefaultApplVerID', () => {
    const wire = engine.encode({
      msgType: 'A',
      fields: { 49: 'A', 56: 'B', 34: 1, 52: '20260801-12:00:00', 98: '0', 108: 30 },
    });
    const { message: parsed } = engine.parse(wire);
    expect(
      engine
        .validate(parsed)
        .some((i) => i.code === 'validate/required-field-missing' && i.refTagID === 1137),
    ).toBe(true);
  });

  it('the LogonBody type REQUIRES DefaultApplVerID', () => {
    const needsLogon = (b: LogonBody): LogonBody => b;
    needsLogon({ EncryptMethod: '0', HeartBtInt: 30, DefaultApplVerID: '9' });
    // @ts-expect-error — DefaultApplVerID(1137) is required on the FIXT Logon
    needsLogon({ EncryptMethod: '0', HeartBtInt: 30 });
  });

  it('covers the session set with typed builders', () => {
    expectTypeOf(message('1').get('TestReqID')).toEqualTypeOf<string | undefined>();
    const hb = message('0').set('TestReqID', 'ping').render(ENV);
    const { message: parsed } = engine.parse(hb);
    expect(parsed.name).toBe('Heartbeat');
    const reject = message('3')
      .assign({ RefSeqNum: 42, SessionRejectReason: Enums.SessionRejectReason.COMPID_PROBLEM })
      .render(ENV);
    expect(engine.parse(reject).message.name).toBe('Reject');
  });
});
