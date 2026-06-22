# @boarteam/fix

A **dictionary-driven FIX protocol toolkit** for TypeScript — parse, validate, and encode
[FIX](https://www.fixtrading.org/) messages with **zero runtime dependencies**, in the
browser or Node.

> ⚠️ **Status: experimental (0.x), under active development.** The API is unstable and may
> change between releases. Not yet published to npm. See
> [`docs/PROJECT_PLAN.md`](docs/PROJECT_PLAN.md) for the roadmap and
> [Maturity & scope](#maturity--scope) for what is and isn't verified.

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

## Install

**Not yet published to npm.** When released it will be:

```bash
pnpm add @boarteam/fix @boarteam/fix-dict-fix44
```

Until then, use it from a checkout — this is a pnpm workspace and cannot be consumed by
`pnpm add github:…` of the repo root (that root is private and unbuilt):

```bash
git clone https://github.com/boarteam/fix-protocol && cd fix-protocol
pnpm install && pnpm -r build
# then reference packages/fix and packages/fix-dict-fix44 from your app (e.g. a file: dep)
```

## Quick start

```ts
import { createFixEngine } from '@boarteam/fix';
import { MsgType, Tags, dictionary } from '@boarteam/fix-dict-fix44';

const fix = createFixEngine(dictionary);

// 1. Parse a raw message (SOH-delimited). Never throws — issues come back as data.
const { message, issues } = fix.parse(raw);
console.log(message.msgType, issues); // FixIssue[] (framing, datatypes, unknown tags, …)

// Repeating groups are arrays of objects, not parallel arrays:
for (const entry of message.groups[268] ?? []) {
  console.log(entry.fields[269]?.value, entry.fields[270]?.value);
}

// 2. Validate against the dictionary: presence, enums, datatypes, conditional rules.
const problems = fix.validate(message);

// 3. Encode — fields are emitted in dictionary order; 8/9/10 framing is computed for you.
const wire = fix.encode({
  msgType: MsgType.NewOrderSingle,
  fields: {
    [Tags.SenderCompID]: 'BUYSIDE',
    [Tags.TargetCompID]: 'SELLSIDE',
    [Tags.MsgSeqNum]: 42,
    [Tags.SendingTime]: '20240101-12:00:00.000',
    [Tags.ClOrdID]: 'ORDER-1',
    [Tags.Symbol]: 'EUR/USD',
    [Tags.Side]: '1',
    [Tags.TransactTime]: '20240101-12:00:00.000',
    [Tags.OrderQty]: 1_000_000,
    [Tags.OrdType]: '2',
    [Tags.Price]: 1.0921,
  },
});
```

Runnable versions of these live in [`examples/`](examples) and are kept green by CI.

## Maturity & scope

`@boarteam/fix` is **experimental (0.x)**. Read this before depending on it:

- **The dictionary is the _complete_ FIX 4.4 spec** (912 fields / 26 components / 93 messages
  / 25 datatypes) — breadth is cheap because it is generated data, not hand-written code. It is
  **cross-checked against the QuickFIX `FIX44.xml` dictionary** by a CI drift gate; every
  accepted difference between the two encodings is documented in
  [`packages/fix-codegen/CROSSCHECK.md`](packages/fix-codegen/CROSSCHECK.md).
- **The engine is generic** and runs over the whole dictionary. Correctness is verified
  hardest on the **market-data + session subset** (golden fixtures + an oracle), with broad
  **round-trip coverage across all 93 messages** and an adversarial/fuzz suite proving parse
  and validate never throw, hang, or crash on malformed input.
- **Known limitations are declared, not hidden.** The flattened spec source under-specifies
  some deeply-nested repeating groups: the dictionary records **35 `coverageGaps`** (10
  unresolved + 25 approximate-body groups), and **10 messages diverge structurally** from
  QuickFIX in those nested groups — all enumerated in the cross-check report. None affect the
  market-data/session subset.
- **Deferred to post-0.1:** FIX 4.2/5.0 dictionaries, a CLI, FIX Orchestra, and deep
  conditional-rule modeling.

## Development

This is a [pnpm](https://pnpm.io/) workspace.

```bash
pnpm install
pnpm build      # build all packages (tsup -> ESM + CJS + d.ts)
pnpm test       # run the test suite (vitest)
pnpm typecheck  # tsc --noEmit across packages
```

## Contributing

Contributions are welcome — see [`CONTRIBUTING.md`](CONTRIBUTING.md) for the development
workflow, the DCO sign-off requirement, and how the cross-check drift gate works. Security
issues: see [`SECURITY.md`](SECURITY.md).

## License

[Apache-2.0](LICENSE) © Boar Team. See [`NOTICE`](NOTICE). "FIX" is a trademark of FIX
Protocol Limited; this is an independent project, not affiliated with or endorsed by FIX
Protocol Limited.
