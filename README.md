# @boarteam/fix

**The free, zero-dependency, TypeScript-first FIX analyzer that runs in the browser.** Paste a raw FIX message — get back named fields, repeating groups expanded into real nested objects, and every framing / datatype / validation problem as data. No license key. No backend. No session engine.

[![npm version](https://img.shields.io/npm/v/@boarteam/fix.svg)](https://www.npmjs.com/package/@boarteam/fix)
[![CI](https://github.com/boarteam/fix-protocol/actions/workflows/ci.yml/badge.svg)](https://github.com/boarteam/fix-protocol/actions/workflows/ci.yml)
[![dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)](#why-zero-dependencies-matters)
[![license](https://img.shields.io/npm/l/@boarteam/fix.svg)](LICENSE)

```ts
import { createFixEngine } from '@boarteam/fix';
import { dictionary } from '@boarteam/fix-dict-fix44';

const fix = createFixEngine(dictionary);

// A Market Data Snapshot (35=W). SOH shown as | for readability.
const raw =
  '8=FIX.4.4|9=130|35=W|49=SENDER|56=TARGET|34=2|52=20240101-12:00:00.000|' +
  '55=EUR/USD|268=2|269=0|270=1.0921|271=1000000|269=1|270=1.0923|271=1000000|10=248';

const { message, issues } = fix.parse(raw, { soh: '|' }); // never throws

message.msgType; // "W"
message.name; // "MarketDataSnapshotFullRefresh"
message.framed; // true
message.fields[55].value; // "EUR/USD"   (name: "Symbol")

issues; // []  — framing, checksum, and datatypes all verified clean
fix.validate(message); // []  — required fields, enums, and conditional rules all pass
```

The decoded `message` — note the `268` repeating group is an **array of nested objects (not parallel arrays)**:

```jsonc
{
  "msgType": "W",
  "name": "MarketDataSnapshotFullRefresh",
  "framed": true,
  "fields": {
    "55": { "tag": 55, "name": "Symbol", "raw": "EUR/USD", "value": "EUR/USD" },
  },
  "groups": {
    "268": [
      // MDEntryType 0 = Bid; price + size come back as typed numbers, not strings
      {
        "fields": {
          "269": { "name": "MDEntryType", "value": "0" },
          "270": { "name": "MDEntryPx", "value": 1.0921 },
          "271": { "name": "MDEntrySize", "value": 1000000 },
        },
      },
      // MDEntryType 1 = Offer
      {
        "fields": {
          "269": { "name": "MDEntryType", "value": "1" },
          "270": { "name": "MDEntryPx", "value": 1.0923 },
          "271": { "name": "MDEntrySize", "value": 1000000 },
        },
      },
    ],
  },
}
```

**Malformed input is data, never an exception.** You have logs full of half-truncated, corrupted, or hand-edited messages, and you have watched free FIX parsers die on them. This one does not. Feed it `39=Z` (not a valid `OrdStatus`), `6=not-a-number`, and a wrong `BodyLength` / `CheckSum`, and `parse` still returns — the problems come back in `issues`:

```jsonc
// fix.parse(brokenRaw) — still no throw; message is populated, issues describe the damage:
{ "code": "parse/invalid-float", "severity": "error",
  "message": "Field AvgPx (6) value \"not-a-number\" is not a valid float.", "path": "AvgPx" }
{ "code": "parse/checksum-mismatch", "severity": "error",
  "message": "CheckSum is 000 but the computed value is 060." }
{ "code": "parse/body-length-mismatch", "severity": "warning" }

// fix.validate(message):
{ "code": "validate/value-not-in-enum", "severity": "error",
  "message": "Field OrdStatus (39) value \"Z\" is not an allowed value.", "path": "OrdStatus" }
// ...plus validate/required-field-missing for any absent required fields.
```

That is the whole pitch: paste a message, get the structure and every defect, in the browser, with zero dependencies. No socket, no sequence numbers, no `connect()`.

---

## Where it fits

There is a real gap in the FIX tooling landscape, and `@boarteam/fix` aims squarely at it: a library you can drop into a **log viewer, a web dashboard, a test harness, or a CI assertion** to decode, validate, and re-encode FIX — with no commercial gate and no server-side session machinery.

Point-in-time snapshot, June 2026. The alternatives are capable tools — this table is about category fit, not quality. The honest differentiators here are browser support, zero dependencies, the analyzer (not session-engine) focus, and the never-throws contract.

| Library                | License    | Price                                                                                       | Browser            | Runtime deps                  | Parse | Validate | Encode                   | Never-throws | FIX versions | Stars    | npm/mo. |
| ---------------------- | ---------- | ------------------------------------------------------------------------------------------- | ------------------ | ----------------------------- | ----- | -------- | ------------------------ | ------------ | ------------ | -------- | ------- |
| **@boarteam/fix** (TS) | Apache-2.0 | Free                                                                                        | **Browser + Node** | **0**                         | ✅    | ✅       | ✅                       | **✅**       | 4.4 + 4.2    | new repo | ~204    |
| fixparser (TS)         | Commercial | Free tier needs a registered license key; encode + connectivity gated behind Pro (~$5K+/yr) | Browser (partial)  | has deps                      | ✅    | ✅       | Pro-only                 | n/a          | multiple     | ~51      | ~9,375  |
| jspurefix (TS)         | Apache-2.0 | Free                                                                                        | Node-only          | has deps + heavy post-install | ✅    | ✅       | ✅ (full session engine) | n/a          | multiple     | ~75      | ~61,370 |

For context — a different category, not embeddable analyzers: **QuickFIX** (C++) and **QuickFIX/J** (Java) are server-side session/transport engines; **simplefix** (Python) is lightweight but unmaintained and Python-only; hosted decoders (FIXSIM, Esprow, and similar) are paste-in SaaS, not npm libraries. If you need a socket that maintains sequence numbers and heartbeats, you want a session engine — see [What this is not](#what-this-is-not).

---

## Three reasons to trust it

**1. It works in front of you.** The block above is real captured output, not a sketch. The repeating group becomes an array of nested objects you can index into; numeric fields like `MDEntryPx (270)` and `OrderQty (38)` come back as typed numbers, not strings. Pure `string` / `Uint8Array` in, structured object out, over `TextEncoder` / `TextDecoder` — no Node-only APIs in the core, so the same engine runs in a browser tab and on a Node backend.

**2. It is provably correct, and it never throws.** `parse` and `validate` return findings as **data** — they never throw, hang, or crash, even on garbage input. `BeginString (8)`, `BodyLength (9)`, and `CheckSum (10)` are computed byte-accurately on encode, and repeating groups are reconstructed faithfully. Correctness is pinned by golden fixtures and a reference oracle for the market-data and session message sets, a decode → encode round-trip across **all 93 FIX 4.4 messages**, and an adversarial robustness suite that asserts `parse` and `validate` never throw, hang, or crash on malformed input. CI runs on Node 18 / 20 / 22 and a browser-like environment, and a bundle check enforces the zero-dependency, browser-safe surface on every commit.

**3. It is enterprise-safe.** **Zero runtime dependencies** — nothing to vet transitively, no heavy post-install, nothing that breaks the browser build. No telemetry. No license key, no registration, no gated "Pro" tier. Apache-2.0, with its explicit patent grant. The engine is pure and deterministic — no wall clock, no randomness, no global state — and it never invents session fields (you supply sequence numbers and timestamps), which is exactly why it is trivially testable and safe to embed.

---

## Install

You need the engine plus at least one dictionary:

```bash
npm install @boarteam/fix @boarteam/fix-dict-fix44
# or
pnpm add @boarteam/fix @boarteam/fix-dict-fix44
```

Swap in `@boarteam/fix-dict-fix42` for FIX 4.2. The dictionary packages declare a peer dependency on `@boarteam/fix`. Requirements: **Node ≥ 18**, or any modern browser. Both are zero-dependency, dual ESM + CJS, with TypeScript types included.

---

## Usage

### Create an engine

```ts
import { createFixEngine } from '@boarteam/fix';
import { dictionary } from '@boarteam/fix-dict-fix44';

const fix = createFixEngine(dictionary);
// fix: { dictionary, parse, parseAll, encode, validate }
```

### Parse

`parse` accepts a `string` or `Uint8Array` and **never throws** — it returns `{ message, issues }`.

```ts
const { message, issues } = fix.parse(raw);

message.msgType; // "8"
message.name; // "ExecutionReport"
message.beginString; // "FIX.4.4"
message.framed; // true

// Typed values where the dictionary says so:
message.fields[38].value; // 1000000   OrderQty  (typed number, not "1000000")
message.fields[6].value; // 1.0921    AvgPx     (typed number)
message.fields[55].value; // "EUR/USD" Symbol

// Each field keeps the verbatim wire value as the source of truth for re-encode:
message.fields[55].raw; // "EUR/USD"

// Repeating groups are arrays of nested objects:
for (const entry of message.groups[268] ?? []) {
  console.log(entry.fields[269]?.value, entry.fields[270]?.value);
}
```

Use `parseAll` for a stream of concatenated messages (e.g. a log file).

### Validate

`validate` checks presence (required fields), enum membership, datatypes, and conditional-required rules against the dictionary, returning a `FixIssue[]`:

```ts
const problems = fix.validate(message);
for (const issue of problems) {
  console.log(issue.severity, issue.code, issue.message, issue.path);
}
```

Every `FixIssue` carries a **stable `code`** (e.g. `validate/value-not-in-enum`, `parse/checksum-mismatch`), a `severity` (`error | warning | info`), a human `message`, and — where relevant — a `path`, `refTagID`, `refSeqNum`, `refMsgType`, or `sessionRejectReason`. The codes are part of the SemVer contract; the human message is not.

### Encode

```ts
import { MsgType, Tags } from '@boarteam/fix-dict-fix44';

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

`encode` emits fields in dictionary order and computes `BeginString (8)`, `BodyLength (9)`, and `CheckSum (10)` byte-accurately. It is pure — **you** supply the session fields (sequence number, sending time); the engine never invents them.

### Reading pipe-delimited logs

Most captured logs render the SOH separator as `|`. Pass it through:

```ts
const { message, issues } = fix.parse(pipeDelimitedLine, { soh: '|' });
```

`parse` options: `soh` (default the SOH byte `0x01`; pass `"|"` to read pipe-delimited logs) and `checkFraming` (default `true`; framing findings come back as issues, never a rejection).

### Lower-level building blocks

If you do not want the engine wrapper, the same capabilities are exported as free functions: `parse`, `parseAll`, `encode`, `validate`, `tokenize`, `splitMessages`, `decodeValue`, `calculateChecksum`, `bodyLength`, `loadDictionary`, `Dictionary`, and `validateDictionary`.

### Output shapes

- **`ParsedMessage`** — `{ msgType, name?, beginString?, framed, fields, groups }`.
- **`ParsedField`** — `{ tag, name?, raw, value }`. `raw` is the verbatim wire value (the source of truth for re-encoding); `value` is the typed value.
- **`ParsedGroupEntry`** — `{ fields, groups }`. Repeating groups are **arrays of nested objects**, addressed by their counter tag (e.g. `message.groups[268]`), not parallel arrays.
- **`FixIssue`** — `{ code, severity, message, path?, refTagID?, refSeqNum?, refMsgType?, sessionRejectReason? }`.

---

## Why zero dependencies matters

For a library that sits in a trading firm's toolchain, the dependency tree _is_ the attack surface and the audit burden. `@boarteam/fix` has **no runtime dependencies** — nothing to vet transitively, nothing to phone home, nothing that breaks the browser build. A CI bundle check enforces this on every commit, so the zero-dependency, browser-safe surface cannot silently regress.

---

## Coverage & correctness

The dictionaries ship as data, generated by the separate `@boarteam/fix-codegen` generator from permissively-licensed sources. The counts below are read directly from the shipped dictionary files.

### FIX 4.4 — `@boarteam/fix-dict-fix44`

| Fields | Messages | Components | Datatypes | Inline repeating groups |
| -----: | -------: | ---------: | --------: | ----------------------: |
|    912 |       93 |        105 |        23 |                      92 |

Generated **directly from the QuickFIX `FIX.4.4` XML data dictionary**. Because the 4.4 structure is generated _from_ QuickFIX, we do not claim it is "cross-checked against QuickFIX" — that would be circular. There are **36 recorded coverage gaps**, all of one kind: `conditional-overlay-unmatched` — conditional-required rules from the facts overlay that did not match a member in the QuickFIX-sourced structure. They are recorded as data in the dictionary, naming exactly what they touch; they are not parsing failures and do not affect the market-data or session message sets.

### FIX 4.2 — `@boarteam/fix-dict-fix42`

| Fields | Messages | Components | Datatypes |
| -----: | -------: | ---------: | --------: |
|    405 |       46 |          2 |        21 |

Generated from the **FIX Repository 2010 Edition** and genuinely **cross-checked against the QuickFIX `FIX42.xml` dictionary** by a CI drift gate. There are **2 recorded coverage gaps**, both `synthesized-datatype`: `MultipleValueString` (synthesized over base `String`) and `Length` (synthesized over base `int`) are each referenced by fields but absent from `Datatypes.xml`.

Field, enum, and datatype **descriptions** are sourced from the Apache-2.0 [FIX Orchestra](https://www.fixtrading.org/standards/fix-orchestra/) files.

---

## What this is not

`@boarteam/fix` is an **analyzer**, deliberately not a session/transport engine. It does not — and will not — open sockets, manage sequence numbers, send heartbeats, handle logon/logout, or persist session state. Those belong to a session engine (QuickFIX, QuickFIX/J, jspurefix, and friends), and we cede that lane to them on purpose.

What it owns instead: decoding and validating messages you already have, encoding messages you construct, and doing all of it in a browser tab or a CI step. If your job is a **log viewer, a web decode dashboard, a test harness, or a CI assertion**, this is built for you. If your job is to _be_ the FIX connection on the wire, reach for a session engine and let this analyze its traffic.

---

## Packages

| Package                                                                              | Version | What it is                                                                 |
| ------------------------------------------------------------------------------------ | ------- | -------------------------------------------------------------------------- |
| [`@boarteam/fix`](https://www.npmjs.com/package/@boarteam/fix)                       | 0.1.1   | The engine: tokenize / parse / validate / encode + the dictionary runtime. |
| [`@boarteam/fix-dict-fix44`](https://www.npmjs.com/package/@boarteam/fix-dict-fix44) | 0.1.0   | Full FIX 4.4 dictionary as data. Peer-depends on `@boarteam/fix`.          |
| [`@boarteam/fix-dict-fix42`](https://www.npmjs.com/package/@boarteam/fix-dict-fix42) | 0.1.0   | Full FIX 4.2 dictionary as data. Peer-depends on `@boarteam/fix`.          |

All packages: zero runtime dependencies, dual ESM + CJS, Node ≥ 18, browser + Node, Apache-2.0. The dictionary packages also export `dictionary`, `Tags` (name → tag), `MsgType` (name → msgtype), and `DICTIONARY_VERSION` (e.g. `"FIX.4.4"`).

---

## Roadmap & stability

This is pre-1.0 software, and we are explicit about what that means rather than hiding it — because you have been burned by abandoned free FIX parsers before.

**The SemVer contract** covers three things:

1. the **output shape** — `ParsedMessage`, `FixIssue`, and the dictionary JSON contract;
2. the **accepted input** to `parse` / `encode` / `validate`;
3. the **set and meaning of issue codes** (the stable `code` strings, e.g. `parse/checksum-mismatch`, `validate/value-not-in-enum`). The human-readable `message` is _not_ part of the contract.

While on `0.x`, a breaking change to any of those ships as a **minor** bump (`0.x → 0.(x+1)`); additive changes and fixes are **patch** bumps. Pin a version, and the issue codes you assert against will not silently change underneath you.

**Maintenance pledge.** A **monthly release / maintenance cadence**. Consistency is the whole point — the prior generation of free JS FIX parsers died from neglect, and that is exactly the failure mode this project is built to avoid. [Issues and feedback](https://github.com/boarteam/fix-protocol/issues) shape the road to 1.0.

**Roadmap.** FIX 5.0 / FIXT.1.1 dictionaries through the same pipeline, a CLI, and first-class FIX Orchestra support.

---

## Development

This is a [pnpm](https://pnpm.io/) monorepo. Tests run on Node 18 / 20 / 22 plus a browser-like environment.

```bash
pnpm install
pnpm build          # build all packages (tsup -> ESM + CJS + d.ts)
pnpm test           # vitest: golden fixtures, round-trip, adversarial suite
pnpm typecheck      # tsc --noEmit across packages
pnpm check:bundle   # enforce the zero-dependency, browser-safe surface
pnpm examples       # run the runnable examples
```

The dictionary data is produced by the separate `@boarteam/fix-codegen` generator from QuickFIX / FIX Repository structure and Apache-2.0 FIX Orchestra descriptions.

---

## Contributing

Contributions are welcome — see [`CONTRIBUTING.md`](CONTRIBUTING.md) for the development workflow, the DCO sign-off requirement, and how the FIX 4.2 cross-check drift gate works. Please also read our [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md). Security reports go through [`SECURITY.md`](SECURITY.md). When changing parsing, validation, or encoding behavior, add or update a golden fixture so the change is provable.

---

## License

[Apache-2.0](LICENSE) © Boar Team.

Dictionary **structure** is derived from QuickFIX (QuickFIX Software License) and the FIX Repository (both permissively licensed); field, enum, and datatype **descriptions** come from the Apache-2.0 FIX Orchestra sources. Full attribution lives in [`NOTICE`](NOTICE) and [`THIRD-PARTY-NOTICES.txt`](THIRD-PARTY-NOTICES.txt). This project carries only permissively-licensed data and does not include CC BY-ND FIX-specification prose.

> FIX is a trademark of FIX Protocol Limited; this is an independent project, not affiliated with or endorsed by FIX Protocol Limited.
