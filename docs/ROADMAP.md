# Roadmap

`@boarteam/fix` follows semantic versioning in the 0.x line; the API may refine ahead of 1.0 as
we learn from real-world use. Pin a version and open an issue with what you need — that feedback
shapes 1.0.

## v0.1 (current)

A zero-dependency FIX toolkit that runs in the browser and in Node:

- **`@boarteam/fix`** — the engine: tokenize, parse (with nested repeating-group
  reconstruction), validate (pure and non-throwing), and encode (dictionary-ordered, with
  byte-accurate `BodyLength`/`CheckSum`) — plus a typed, self-rendering `Message` builder over
  the generated per-message body types (renders byte-identical to `encode`).
- **`@boarteam/fix-dict-fix44`** — the complete FIX 4.4 dictionary as data (912 fields /
  93 messages / 105 components / 23 datatypes), generated directly from the QuickFIX
  `FIX44.xml` data dictionary (so not "cross-checked" against it — that would be circular).
- **`@boarteam/fix-dict-fix42`** — the complete FIX 4.2 dictionary as data (405 fields /
  46 messages / 21 datatypes), generated from the official FIX 4.2 specification (FIX
  Repository, 2010 Edition) and cross-checked against the QuickFIX `FIX42.xml` dictionary.

Correctness is verified hardest on the market-data and session message sets (golden fixtures
plus a reference oracle), with round-trip coverage across all 93 messages and an
adversarial/fuzz suite proving that parse and validate never throw, hang, or crash on malformed
input. CI runs on Node 18/20/22 and a browser-like environment.

A few deeply-nested repeating groups are under-specified by the flattened spec source; the
dictionary records these as `coverageGaps`, and they do not affect the market-data or session
message sets.

## Shipped since 0.1

- **The FIX 5.0 SP2 / FIXT.1.1 dictionaries** — via the same generate-and-cross-check
  pipeline: `@boarteam/fix-dict-fix50sp2` (self-contained: FIXT envelope + 7 session
  messages + 108 base-SP2 application messages, 1,452 fields, cross-checked against
  quickfix-go's independently-maintained SP2 dictionary) and `@boarteam/fix-dict-fixt11`
  (transport-only). The engine models the transport/application split first-class: every
  codec entry point accepts a `{ transport, app }` dictionary pair, `validate` attributes
  findings to the `session` vs `application` layer (choose `Reject(3)` vs
  `BusinessMessageReject(j)`), and an optional `resolveApp(applVerID)` hook routes
  multi-version sessions — with no session state held. Conformance includes byte-pinned
  golden FIXT frames accepted by quickfix-go's own transport/application validator.

## Planned

- A CLI (`parse` / `encode` / `lint` / `gen`).
- FIX Orchestra as a dictionary source.
- Richer conditional-rule (`C`) modeling and deeper conformance across the full message sets.

All behind the same public API.

## Design principles

- **Pure and deterministic** — no wall-clock, no randomness, no global state; the caller
  supplies timestamps and sequence numbers.
- **Non-throwing on the analyze path** — every issue comes back as data (`FixIssue[]`), never an
  exception.
- **Browser-safe** — `string | Uint8Array` in and out via `TextEncoder`/`TextDecoder`; no
  `Buffer` and no Node-only APIs in the core.
- **Dictionary-driven** — custom and extended dictionaries are first-class; the engine runs over
  data, not hard-coded message types.
