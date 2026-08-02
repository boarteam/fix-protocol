// FIX 5.0 SP2 over FIXT.1.1 with the transport/application dictionary pair: build a typed
// Logon (whose body REQUIRES DefaultApplVerID=9) and an ExecutionReport, then validate with
// layer-attributed findings — `session` findings answer with a Reject(3), `application`
// findings with a BusinessMessageReject(j).
//
//   pnpm --filter @boarteam/fix-examples start:fixt
//
import { createFixEngine } from '@boarteam/fix';
import { dictionary as fixt11 } from '@boarteam/fix-dict-fixt11';
import { Enums, MsgType, dictionary as fix50sp2, message } from '@boarteam/fix-dict-fix50sp2';

const SOH = '\x01';
const show = (s) => s.split(SOH).join('|');

/** Run the example; returns facts the example test asserts on. */
export function run() {
  // The pair: FIXT.1.1 transport (envelope + session messages) + FIX 5.0 SP2 application
  // layer. Parsing/encoding run over the merged view; validation attributes layers.
  const fix = createFixEngine({ transport: fixt11, app: fix50sp2 });

  const envelope = {
    SenderCompID: 'BUYSIDE',
    TargetCompID: 'VENUE',
    MsgSeqNum: 1,
    SendingTime: '20260801-12:00:00.000',
  };

  // The FIXT Logon: DefaultApplVerID(1137) is required — by the dictionary AND by the
  // generated LogonBody type. Tag 8 carries FIXT.1.1; 1137 carries the app version.
  const logonWire = message(MsgType.Logon)
    .assign({
      EncryptMethod: '0',
      HeartBtInt: 30,
      DefaultApplVerID: Enums.ApplVerID.FIX50SP2, // '9'
    })
    .render(envelope);
  console.log('FIXT Logon (SOH shown as |):');
  console.log('  ' + show(logonWire));

  // An application message under the same envelope.
  const erWire = fix.encode({
    msgType: '8',
    fields: {
      49: 'VENUE',
      56: 'BUYSIDE',
      34: 2,
      52: '20260801-12:00:00.500',
      37: 'ORD-1',
      17: 'EXEC-1',
      150: '0',
      39: '0',
      55: 'EURUSD',
      54: '1',
      151: '1000000',
      14: '0',
      6: '0',
    },
  });
  console.log('ExecutionReport over FIXT.1.1:');
  console.log('  ' + show(erWire));

  // Layer attribution: strip the required DefaultApplVerID from the Logon and the required
  // OrderID from the ExecutionReport, then look at each finding's `layer`.
  const brokenLogon = fix.parse(logonWire).message;
  delete brokenLogon.fields[1137];
  const sessionFinding = fix
    .validate(brokenLogon)
    .find((i) => i.code === 'validate/required-field-missing');

  const brokenEr = fix.parse(erWire).message;
  delete brokenEr.fields[37];
  const applicationFinding = fix
    .validate(brokenEr)
    .find((i) => i.code === 'validate/required-field-missing');

  console.log(
    `Missing 1137 on Logon      → layer '${sessionFinding?.layer}'  (answer with a session Reject(3))`,
  );
  console.log(
    `Missing 37 on ExecReport   → layer '${applicationFinding?.layer}' (answer with a BusinessMessageReject(j))`,
  );

  const logonParsed = fix.parse(logonWire);
  return {
    logonBeginString: logonParsed.message.beginString,
    logonIssues: logonParsed.issues.length,
    logonValidation: fix.validate(logonParsed.message).length,
    sessionLayer: sessionFinding?.layer,
    applicationLayer: applicationFinding?.layer,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run();
}
