# @boarteam/fix-dict-fix44

The **complete FIX 4.4 dictionary as data** (912 fields / 93 messages / 105 components / 23
datatypes) for the [`@boarteam/fix`](https://www.npmjs.com/package/@boarteam/fix) engine.
Generated directly from the QuickFIX `FIX44.xml` data dictionary — never hand-maintained.

On a 0.x line and actively developed. See the
[project README](https://github.com/boarteam/fix-protocol#readme) for coverage and declared
coverage gaps.

```ts
import { createFixEngine } from '@boarteam/fix';
import { dictionary, Tags, MsgType } from '@boarteam/fix-dict-fix44';

const fix = createFixEngine(dictionary);
const wire = fix.encode({ msgType: MsgType.NewOrderSingle, fields: { [Tags.ClOrdID]: 'A1' } });
```

Exports: `dictionary` (the data), `Tags` (field name → tag), `TagNames` (tag → field
name), `MsgType` (message name → MsgType value), `MsgTypeNames` (MsgType value →
message name), `Enums` (field name → spec value name → wire string, e.g.
`Enums.MDEntryType.BID === '0'`), a top-level const per enumerated field (`Side`,
`OrdType`, `MDEntryType`, ...), and `DICTIONARY_VERSION`. `MsgType` and every
per-field const are also same-name types — unions of their wire values — so
`msgType: MsgType` and `side: Side` work in type positions. The one enumerated
field without a top-level const is `MsgType` (tag 35), whose name belongs to the
message-type map: use `Enums.MsgType`.

Requires `@boarteam/fix` as a peer dependency.

## License

[Apache-2.0](./LICENSE) © Boar Team. See [`NOTICE`](./NOTICE). The dictionary data is derived
from the publicly published FIX 4.4 specification. "FIX" is a trademark of FIX Protocol
Limited; this is an independent project, not affiliated with or endorsed by it.
