# @boarteam/fix

A **dictionary-driven FIX protocol toolkit** for TypeScript — parse, validate, and encode
[FIX](https://www.fixtrading.org/) messages with **zero runtime dependencies**, in the
browser or Node.

> ⚠️ **Status: experimental (0.x), under active development.** The API is unstable and may
> change between releases. Not yet published to npm. See
> [`docs/PROJECT_PLAN.md`](docs/PROJECT_PLAN.md) for the roadmap.

## Why this exists

There is no battle-tested, open, dependency-free FIX engine for TypeScript. Existing options
are either commercial/single-vendor or thin. `@boarteam/fix` aims to be the clean way to
**decode, validate, and diff FIX messages** — the engine behind a connection-less analyzer
(paste a message or a log; get a colorized, validated, navigable view) that runs equally in
a browser tab and on a Node backend. It is intentionally **not** a session/transport engine:
no sockets, no sequence numbers, no heartbeats — just the protocol.

## Design principles

- **Dictionary-driven.** Parsing, validation, and encoding are all driven by a
  data-only FIX dictionary, so the same engine works across FIX versions and custom/extended
  dictionaries.
- **Pure & deterministic.** No wall-clock, no randomness, no global state; the caller
  supplies timestamps and sequence numbers. Trivially testable.
- **Never crashes on bad input.** Parsing and validation return structured diagnostics
  (`FixIssue[]`) rather than throwing — essential for analyzing untrusted logs.
- **Browser + Node.** Operates on `string` / `Uint8Array` via `TextEncoder`/`TextDecoder`;
  no Node-only APIs in the core.
- **Correct on the wire.** Byte-accurate `BodyLength` and `CheckSum`; faithful
  repeating-group reconstruction.

## Packages

| Package                                               | Description                                                                |
| ----------------------------------------------------- | -------------------------------------------------------------------------- |
| [`@boarteam/fix`](packages/fix)                       | The engine: tokenize, parse, validate, encode, and the dictionary runtime. |
| [`@boarteam/fix-dict-fix44`](packages/fix-dict-fix44) | The full FIX 4.4 dictionary as data, generated from the specification.     |
| `@boarteam/fix-codegen`                               | Build-time generator (spec → dictionary JSON). Not published.              |

## Planned API (preview)

```ts
import { createFixEngine } from '@boarteam/fix';
import { fix44 } from '@boarteam/fix-dict-fix44';

const fix = createFixEngine(fix44);

const { message, issues } = fix.parse(raw); // never throws; issues is FixIssue[]
const problems = fix.validate(message); // presence, enums, datatypes, group counts
const wire = fix.encode({
  msgType: 'V',
  fields: {
    /* ... */
  },
});
```

## Development

This is a [pnpm](https://pnpm.io/) workspace.

```bash
pnpm install
pnpm build      # build all packages (tsup -> ESM + CJS + d.ts)
pnpm test       # run the test suite (vitest)
pnpm typecheck  # tsc --noEmit across packages
```

## License

[Apache-2.0](LICENSE) © Boar Team. See [`NOTICE`](NOTICE). "FIX" is a trademark of FIX
Protocol Limited; this is an independent project, not affiliated with or endorsed by FIX
Protocol Limited.
