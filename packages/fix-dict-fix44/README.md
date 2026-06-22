# @boarteam/fix-dict-fix44

The **complete FIX 4.4 dictionary as data** (912 fields / 26 components / 93 messages / 25
datatypes) for the [`@boarteam/fix`](https://www.npmjs.com/package/@boarteam/fix) engine.
Generated from the FIX 4.4 specification and cross-checked against the QuickFIX `FIX44.xml`
dictionary by a CI drift gate — never hand-maintained.

> ⚠️ **Experimental (0.x).** See the
> [project README](https://github.com/boarteam/fix-protocol#readme) for maturity, the
> subset-vs-full correctness note, and declared coverage gaps.

```ts
import { createFixEngine } from '@boarteam/fix';
import { dictionary, Tags, MsgType } from '@boarteam/fix-dict-fix44';

const fix = createFixEngine(dictionary);
const wire = fix.encode({ msgType: MsgType.NewOrderSingle, fields: { [Tags.ClOrdID]: 'A1' } });
```

Exports: `dictionary` (the data), `Tags` (field name → tag), `MsgType` (message name →
MsgType value), and `DICTIONARY_VERSION`.

Requires `@boarteam/fix` as a peer dependency.

## License

[Apache-2.0](./LICENSE) © Boar Team. See [`NOTICE`](./NOTICE). The dictionary data is derived
from the publicly published FIX 4.4 specification. "FIX" is a trademark of FIX Protocol
Limited; this is an independent project, not affiliated with or endorsed by it.
