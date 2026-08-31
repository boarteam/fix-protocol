// Read inbound FIX messages through the typed read view: a name-keyed body, the session
// envelope on the side, and one switch that dispatches on MsgType.
//
// `parse` returns the wire faithfully but tag-keyed — `message.fields[262].value`, groups
// under `message.groups[268]`. `toInbound` (here via `engine.inbound`) re-keys that by
// dictionary name, so the same message reads as `get('MDReqID')` and `get('NoMDEntries')`.
// In TypeScript those reads are typed per MsgType inside the switch; this file is plain
// JS, so what it shows is the shape.
//
//   pnpm --filter @boarteam/fix-examples start:read
//
import { createFixEngine } from '@boarteam/fix';
import { MsgType, dictionary } from '@boarteam/fix-dict-fix44';

const SOH = '\x01';
const wire = (s) => s.split('|').join(SOH);

// Three frames a market-data session receives. The last one carries a MsgType FIX 4.4 does
// not define — the case the known-guard exists for.
const LOGON = wire(
  '8=FIX.4.4|9=62|35=A|49=VENUE|56=ME|34=1|52=20260901-09:30:00.000|98=0|108=30|10=003|',
);
const SNAPSHOT = wire(
  '8=FIX.4.4|9=159|35=W|49=VENUE|56=ME|34=2|52=20260901-09:30:01.250|262=req-1|55=EURUSD|' +
    '48=sec-eurusd-001|22=8|268=2|269=0|270=1.10545|271=2000000|269=1|270=1.10549|271=1500000|10=117|',
);
const UNKNOWN = wire('8=FIX.4.4|9=51|35=ZZ|49=VENUE|56=ME|34=3|52=20260901-09:30:02.000|10=095|');

/** Run the example and return what each frame dispatched to. */
export function run() {
  const fix = createFixEngine(dictionary);
  const handled = [];

  for (const raw of [LOGON, SNAPSHOT, UNKNOWN]) {
    // Parse first and gate on the diagnostics: they are what decide whether the message is
    // worth reading at all. `parse` never throws — every problem comes back as data.
    //
    // `parse/unknown-msgtype` is tolerated here rather than rejected, which is what makes
    // the guard below reachable. A real session picks a side per direction: an acceptor
    // usually answers an unknown MsgType with a session Reject, while a client reading a
    // venue's stream logs it and keeps the session up.
    const { message, issues } = fix.parse(raw);
    const fatal = issues.filter(
      (i) => i.severity === 'error' && i.code !== 'parse/unknown-msgtype',
    );
    if (fatal.length) {
      console.log(`rejected: ${fatal.map((i) => i.code).join(', ')}`);
      continue;
    }

    const inbound = fix.inbound(message);

    // The session envelope is readable before any narrowing — it is the same shape on every
    // message, which is exactly why the body types exclude it.
    const seq = inbound.envelope.MsgSeqNum;
    const from = inbound.envelope.SenderCompID;

    // A MsgType the dictionary does not define cannot take part in the typed dispatch: it
    // parses flat, with no repeating groups reconstructed, so there is nothing to narrow to.
    if (!fix.isKnown(inbound)) {
      console.log(`${from} #${seq} unknown MsgType ${inbound.msgType} — cannot dispatch`);
      handled.push('unknown');
      continue;
    }

    switch (inbound.msgType) {
      case MsgType.Logon: {
        console.log(`${from} #${seq} logon, heartbeat every ${inbound.get('HeartBtInt')}s`);
        handled.push('logon');
        break;
      }

      case MsgType.MarketDataSnapshotFullRefresh: {
        // Groups are arrays of entry objects keyed by the counter's name, so an entry that
        // omits an optional field cannot shift its neighbours' values.
        const entries = inbound.get('NoMDEntries') ?? [];
        const book = entries.map((e) => `${e.MDEntryType === '0' ? 'bid' : 'ask'} ${e.MDEntryPx}`);
        console.log(
          `${from} #${seq} ${inbound.get('Symbol')} (${inbound.get('SecurityID')}) ` +
            `for ${inbound.get('MDReqID')}: ${book.join(', ')}`,
        );
        handled.push('snapshot');
        break;
      }

      default: {
        // A message FIX 4.4 defines that this session does not serve.
        console.log(`${from} #${seq} unhandled ${inbound.msgType}`);
        handled.push('unhandled');
        break;
      }
    }
  }

  return handled;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run();
}
