# @boarteam/fix

A **dictionary-driven FIX protocol toolkit** for TypeScript — parse, validate, and encode
[FIX](https://www.fixtrading.org/) messages with **zero runtime dependencies**, in the
browser or Node.

[![npm](https://img.shields.io/npm/v/@boarteam/fix.svg)](https://www.npmjs.com/package/@boarteam/fix)
[![CI](https://github.com/boarteam/fix-protocol/actions/workflows/ci.yml/badge.svg)](https://github.com/boarteam/fix-protocol/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/@boarteam/fix.svg)](LICENSE)

The most complete open, dependency-free FIX toolkit for TypeScript: the full FIX 4.4
dictionary, a correct engine, and an extensive test suite. It's on a 0.x line — the foundation
is solid and the API may still refine ahead of 1.0, guided by real-world use.
[Issues and feedback](https://github.com/boarteam/fix-protocol/issues) are very welcome.

## Why this exists

Open FIX tooling for TypeScript has been either commercial/single-vendor or too thin to rely
on. `@boarteam/fix` is the clean, correct way to **decode, validate, and diff FIX messages** —
the engine behind a connection-less analyzer (paste a message or a log; get a colorized,
validated, navigable view) that runs equally in a browser tab and on a Node backend. It is
intentionally **not** a session/transport engine: no sockets, no sequence numbers, no
heartbeats — just the protocol, done right.

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
| [`@boarteam/fix-dict-fix42`](packages/fix-dict-fix42) | The full FIX 4.2 dictionary as data, generated from the specification.     |

## Install

```bash
pnpm add @boarteam/fix @boarteam/fix-dict-fix44
# or: npm install @boarteam/fix @boarteam/fix-dict-fix44
```

`@boarteam/fix` is the engine; `@boarteam/fix-dict-fix44` is the FIX 4.4 dictionary it runs
over. Both are zero-dependency ESM/CJS and work in the browser and Node.

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

## Coverage & correctness

- **Complete FIX 4.4 dictionary** — 912 fields / 26 components / 93 messages / 25 datatypes,
  generated from the specification and **cross-checked against the QuickFIX `FIX44.xml`
  dictionary**. Each difference between the two encodings is reconciled and documented; the
  generator and cross-check tooling are maintained alongside the FIX spec, and the reconciled
  result is committed here as data.
- **Complete FIX 4.2 dictionary** — 405 fields / 46 messages / 21 datatypes, generated from the
  official FIX 4.2 specification (FIX Repository, 2010 Edition) and **cross-checked against the
  QuickFIX `FIX42.xml` dictionary** — its message structures match QuickFIX's exactly, with only
  a handful of documented naming/enum deltas. Install `@boarteam/fix-dict-fix42` instead of (or
  alongside) the 4.4 dictionary; the engine is the same.
- **Thoroughly tested** — golden fixtures and a reference oracle for the market-data and
  session message sets, round-trip coverage across all 93 messages, and an adversarial/fuzz
  suite that proves parse and validate never throw, hang, or crash on malformed input. CI runs
  on Node 18/20/22 and a browser-like environment.
- **Transparent about edge cases** — the flattened spec source under-specifies a few
  deeply-nested repeating groups; the dictionary records these as `coverageGaps`, naming
  exactly which messages they touch, so nothing is hidden. They do not affect the market-data
  or session message sets.
- **0.x and evolving** — the API may refine ahead of 1.0 as we learn from real-world use. Pin a
  version, and open an issue with what you need — that feedback shapes 1.0.
- **On the roadmap** — the FIX 5.0 / FIXT.1.1 dictionaries (via the same cross-check pipeline), a
  CLI, and FIX Orchestra support.

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
