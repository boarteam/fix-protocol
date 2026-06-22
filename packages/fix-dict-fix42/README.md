# @boarteam/fix-dict-fix42

The **complete FIX 4.2 dictionary as data** (405 fields / 46 messages / 21 datatypes) for the
[`@boarteam/fix`](https://www.npmjs.com/package/@boarteam/fix) engine. Generated from the
official FIX 4.2 specification (FIX Repository, 2010 Edition) and cross-checked against the
QuickFIX `FIX42.xml` dictionary by a CI drift gate — never hand-maintained.

On a 0.x line and actively developed. See the
[project README](https://github.com/boarteam/fix-protocol#readme) for coverage, the cross-check
report, and declared coverage gaps.

```ts
import { createFixEngine } from '@boarteam/fix';
import { dictionary, Tags, MsgType } from '@boarteam/fix-dict-fix42';

const fix = createFixEngine(dictionary);
const wire = fix.encode({ msgType: MsgType.OrderSingle, fields: { [Tags.ClOrdID]: 'A1' } });
```

Exports: `dictionary` (the data), `Tags` (field name → tag), `MsgType` (message name →
MsgType value), and `DICTIONARY_VERSION`.

Requires `@boarteam/fix` as a peer dependency.

## License

[Apache-2.0](./LICENSE) © Boar Team. See [`NOTICE`](./NOTICE). The dictionary data is derived
from the official FIX 4.2 specification (FIX Repository, 2010 Edition), which is
"Copyright FIX Protocol Limited". "FIX" is a trademark of FIX Protocol Limited; this is an
independent project, not affiliated with or endorsed by it.
