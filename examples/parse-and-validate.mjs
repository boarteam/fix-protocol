// Parse a raw FIX 4.4 message, then validate it — both return data, never throw.
//
//   pnpm --filter @boarteam/fix-examples start:parse
//
import { createFixEngine } from '@boarteam/fix';
import { dictionary } from '@boarteam/fix-dict-fix44';

const SOH = '\x01';

// A Market Data Snapshot (35=W) with a repeating group (NoMDEntries, 268), correctly framed
// (BodyLength 9=130, CheckSum 10=195) — i.e. exactly what you'd paste from a log.
const raw = [
  '8=FIX.4.4',
  '9=130',
  '35=W',
  '49=SENDER',
  '56=TARGET',
  '34=2',
  '52=20240101-12:00:00.000',
  '55=EUR/USD',
  '268=2', // two market-data entries
  '269=0', // entry 1: Bid
  '270=1.0921',
  '271=1000000',
  '269=1', // entry 2: Offer
  '270=1.0923',
  '271=1000000',
  '10=195',
].join(SOH);

/** Run the example and return a small result object (used by the test harness). */
export function run() {
  const fix = createFixEngine(dictionary);

  const { message, issues } = fix.parse(raw);
  console.log(
    `Parsed ${message.msgType} (${fix.dictionary.messageByMsgType(message.msgType)?.name})`,
  );

  // Repeating groups come back as arrays of objects, not parallel arrays.
  const entries = message.groups?.[268] ?? [];
  console.log(`  ${entries.length} market-data entries:`);
  for (const entry of entries) {
    console.log(`    type=${entry.fields?.[269]?.value} px=${entry.fields?.[270]?.value}`);
  }

  const problems = fix.validate(message);
  console.log(`  parse issues: ${issues.length}, validation issues: ${problems.length}`);

  return {
    msgType: message.msgType,
    entries: entries.length,
    issues: issues.length,
    problems: problems.length,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run();
}
