# Roadmap

`@boarteam/fix` follows semantic versioning in the 0.x line; the API may refine ahead of 1.0 as
we learn from real-world use. Pin a version and open an issue with what you need — that feedback
shapes 1.0.

## v0.1 (current)

A zero-dependency FIX toolkit that runs in the browser and in Node:

- **`@boarteam/fix`** — the engine: tokenize, parse (with nested repeating-group
  reconstruction), validate (pure and non-throwing), and encode (dictionary-ordered, with
  byte-accurate `BodyLength`/`CheckSum`).
- **`@boarteam/fix-dict-fix44`** — the complete FIX 4.4 dictionary as data (912 fields /
  26 components / 93 messages / 25 datatypes), generated from the specification and
  cross-checked against the QuickFIX `FIX44.xml` dictionary.

Correctness is verified hardest on the market-data and session message sets (golden fixtures
plus a reference oracle), with round-trip coverage across all 93 messages and an
adversarial/fuzz suite proving that parse and validate never throw, hang, or crash on malformed
input. CI runs on Node 18/20/22 and a browser-like environment.

A few deeply-nested repeating groups are under-specified by the flattened spec source; the
dictionary records these as `coverageGaps`, and they do not affect the market-data or session
message sets.

## Post-0.1 (planned)

- Additional dictionaries — FIX 4.2 and 5.0 — via the same generate-and-cross-check pipeline.
- A CLI (`parse` / `encode` / `lint` / `gen`).
- FIX Orchestra as a dictionary source.
- Richer conditional-rule (`C`) modeling and deeper conformance across the full 93-message set.

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
