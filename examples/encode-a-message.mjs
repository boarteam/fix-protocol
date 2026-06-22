// Build and encode a FIX 4.4 message. Fields are emitted in the dictionary-prescribed order;
// BeginString (8), BodyLength (9), and CheckSum (10) are computed for you, byte-accurately.
//
//   pnpm --filter @boarteam/fix-examples start:encode
//
import { createFixEngine } from '@boarteam/fix';
import { MsgType, Tags, dictionary } from '@boarteam/fix-dict-fix44';

const SOH = '\x01';

/** Run the example and return the encoded wire string. */
export function run() {
  const fix = createFixEngine(dictionary);

  // A New Order - Single (35=D). The caller supplies session fields (seq num, sending time);
  // the engine is pure and never invents them.
  const wire = fix.encode({
    msgType: MsgType.NewOrderSingle,
    fields: {
      [Tags.SenderCompID]: 'BUYSIDE',
      [Tags.TargetCompID]: 'SELLSIDE',
      [Tags.MsgSeqNum]: 42,
      [Tags.SendingTime]: '20240101-12:00:00.000',
      [Tags.ClOrdID]: 'ORDER-1',
      [Tags.Symbol]: 'EUR/USD',
      [Tags.Side]: '1', // Buy
      [Tags.TransactTime]: '20240101-12:00:00.000',
      [Tags.OrderQty]: 1000000,
      [Tags.OrdType]: '2', // Limit
      [Tags.Price]: 1.0921,
    },
  });

  console.log('Encoded (SOH shown as |):');
  console.log('  ' + wire.split(SOH).join('|'));

  // Re-parse to confirm the framing is valid.
  const { message, issues } = fix.parse(wire);
  console.log(`Round-trip: ${message.msgType}, ${issues.length} issue(s)`);

  return wire;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run();
}
