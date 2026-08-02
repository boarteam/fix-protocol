# @boarteam/fix-dict-fix42

The **complete FIX 4.2 dictionary as data** (405 fields / 46 messages / 21 datatypes) for the
[`@boarteam/fix`](https://www.npmjs.com/package/@boarteam/fix) engine. Generated from the
official FIX 4.2 specification (FIX Repository, 2010 Edition) and cross-checked against the
QuickFIX `FIX42.xml` dictionary by a CI drift gate — never hand-maintained.

Stable and actively developed. See the
[project README](https://github.com/boarteam/fix-protocol#readme) for coverage, the cross-check
report, and declared coverage gaps.

```ts
import { createFixEngine } from '@boarteam/fix';
import { dictionary, Tags, MsgType } from '@boarteam/fix-dict-fix42';

const fix = createFixEngine(dictionary);
const wire = fix.encode({ msgType: MsgType.OrderSingle, fields: { [Tags.ClOrdID]: 'A1' } });
```

Exports: `dictionary` (the data), `Tags` (field name → tag), `TagNames` (tag → field
name), `MsgType` (message name → MsgType value), `MsgTypeNames` (MsgType value →
message name), `Enums` (field name → spec value name → wire string, e.g.
`Enums.MDEntryType.Bid === '0'`), a top-level const per enumerated field (`Side`,
`OrdType`, `MDEntryType`, ...), and `DICTIONARY_VERSION`. `MsgType` and every
per-field const are also same-name types — unions of their wire values — so
`msgType: MsgType` and `side: Side` work in type positions. The one enumerated
field without a top-level const is `MsgType` (tag 35), whose name belongs to the
message-type map: use `Enums.MsgType`.

It also exports the typed encode-side API: `message` (a factory bound to this dictionary),
`MessageBodies` (the `MsgType` value → body-type registry), and a named body type per message
plus augmentable per-container group/component `interface`s. For the read side it exports
`isMessageType` (a type guard that narrows a `MessageView<any>` of unknown type to a specific
message's body, keyed on its `MsgType` value) and `MessageOf<M>` (the matching annotation alias).
See the [`@boarteam/fix` README](https://www.npmjs.com/package/@boarteam/fix) for the
typed-message API.

Requires `@boarteam/fix` as a peer dependency.

## License

[Apache-2.0](./LICENSE) © Boar Team. See [`NOTICE`](./NOTICE). The dictionary data is derived
from the official FIX 4.2 specification (FIX Repository, 2010 Edition), which is
"Copyright FIX Protocol Limited". "FIX" is a trademark of FIX Protocol Limited; this is an
independent project, not affiliated with or endorsed by it.
