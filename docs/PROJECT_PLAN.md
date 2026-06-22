# Plan — `@boarteam/fix`: an open-source, dictionary-driven FIX toolkit (TypeScript)

## Context

We are open-sourcing pieces of the private `boar-trading` platform, governed by the new
[`open-source-readiness.md`](/Users/jifeon/projects/fix/docs/open-source-readiness.md)
standard. **This first project is a tools library, not a session/transport engine** — it
extracts the pure *parse / validate / encode / dictionary* logic from
`boar-trading/packages/api/src/modules/fix-protocol` and leaves the stateful session
manager behind.

**Why now / what prompted it.** The companion findings doc establishes that (a) there is
**no battle-tested open TypeScript FIX engine**, and (b) the safe product wedge is a
*connection-less, browser+Node FIX analyzer* (decode/validate/diff a pasted message or
log). The boar-trading module already contains a genuinely good **dictionary metamodel**
(fields → groups → nested components, recursively) — but the parser and encoder don't
actually use it, so groups are parsed losslessly-incorrectly and the encoder is welded to
venue/DB types. Extracting and *unifying* this around the dictionary — and **feeding it
the complete FIX 4.4 spec we already scraped into this repo** — turns proven internal code
into that missing open library.

**Decisions already made (user):**
1. **Broad, multi-version foundation** — a small monorepo with a data-driven, *pluggable*
   dictionary, generated from a spec source, extensible to other FIX versions / custom
   dictionaries.
2. **Zero-dependency validator** — drop Joi; validate directly from the dictionary.
3. **Full dictionaries, generated from this repo's docs** — v0.1 ships the *complete* FIX
   4.4 dictionary (912 fields / 26 components / 93 messages / 25 datatypes) generated from
   the Markdown reference in `/Users/jifeon/projects/fix`, **not** the ~13-message curated
   subset.
4. npm scope **`@boarteam`**; license **Apache-2.0** (protocol/fintech default — patent
   grant); repo at `/Users/jifeon/projects/fix-protocol`.

**Intended outcome.** A publishable **v0.1** of `@boarteam/fix` + `@boarteam/fix-dict-fix44`:
zero-dependency, runs in browser and Node, with a **full FIX 4.4 dictionary** and an engine
that parses/validates/encodes **correctly (incl. repeating groups, byte-accurate
checksums)** — architected to grow to 4.2/5.0 and custom dictionaries, meeting Tier 0–2 of
the readiness standard.

> **Scope discipline (synthesis of both design reviews).** The *dictionary* is full FIX
> 4.4 (it's generated data — breadth is cheap). The *engine* is generic and runs over the
> whole dictionary, but **correctness is verified hardest on the market-data + session
> subset** (where we have the boar-trading oracle + known fixtures), with broad
> round-trip/smoke coverage across all 93 messages. Deferred to post-0.1: FIX 4.2/5.0
> dictionaries, the CLI, FIX Orchestra, and deep conditional-rule modeling. The README
> states this maturity honestly. Both design agents flagged "ambition → never ships" as the
> top risk; this is the mitigation.

---

## Target architecture

Monorepo at `/Users/jifeon/projects/fix-protocol` (pnpm workspaces). Packages:

| Package | v0.1? | Purpose |
|---|---|---|
| **`@boarteam/fix`** | ✅ published | Stateless engine: tokenize, parse (+ group reconstruction), encode (ordered + checksum), validate (pure), diagnostics, the **Dictionary** runtime + JSON contract, `createFixEngine`. Zero runtime deps. Browser+Node. |
| **`@boarteam/fix-dict-fix44`** | ✅ published | The **full** FIX 4.4 dictionary as shipped **JSON data** + emitted typed `Tags`/`MsgType`/enum helpers. **Generated** from this repo's Markdown spec; never hand-maintained. |
| **`@boarteam/fix-codegen`** | ✅ on critical path, **not** published as a runtime dep | Build-time generator: **Markdown spec → Dictionary JSON** (primary), **QuickFIX `FIX44.xml` → JSON** (canonical cross-check). Node-only; emits the `fix-dict-fix44` data files. Consumers never pull it. |
| **`@boarteam/fix-cli`** | ❌ deferred → M5 | `fixkit parse/encode/lint/gen`. |

> The Dictionary **JSON contract** lives inside `@boarteam/fix` for v0.1 (exported);
> `@boarteam/fix-codegen` imports it for types. Extract to a standalone
> `@boarteam/fix-dictionary` only if a third consumer needs the contract without the engine.
> Published runtime surface stays at two packages.

### `@boarteam/fix` source layout
```
src/
  dictionary/
    types.ts            # FieldDef, EnumDef, DataTypeDef, ComponentDef, GroupDef,
                        #   MessageDef, MemberRef(reqd: Y|N|C), DictionaryJSON — plain data
    Dictionary.ts       # runtime over JSON: byTag/byName/messageByMsgType, reverse index
                        #   usedIn(tag), allowed-tag sets, group first-field boundary meta
    validateDictionary.ts
  codec/
    tokenize.ts         # SOH split -> ordered (tag,value)[]; SOH param; value-with-'=' fix
    datatypes.ts        # FIX<->JS coercion (int/float/Qty/Price/UTCTimestamp/Boolean/...)
    groups.ts           # repeating-group reconstruction (parse) + emission (encode)
    parse.ts            # dictionary-driven: pairs -> nested ParsedMessage + diagnostics
    encode.ts           # ordered field emission per member order + BodyLength + CheckSum
    checksum.ts         # checksum + bodyLength over UTF-8 BYTES (TextEncoder)
  validate/
    validate.ts         # presence(Y/N)/enum/datatype/group-count -> Issue[]
    conditions.ts       # conditional (C) presence evaluator
  errors.ts             # FixIssue (code, severity, location, refTagID/refSeqNum/...) — data, not thrown
  engine.ts             # createFixEngine(dictionary, options) -> { parse, validate, encode, dictionary }
  index.ts              # curated public API
```

### Public API (sketch)
```ts
createFixEngine(dictionary, options?) -> { parse, validate, encode, dictionary }
parse(raw: string | Uint8Array, dictionary, options?) -> { message: ParsedMessage; issues: FixIssue[] }   // never throws
encode(msg: { msgType; fields; groups? }, dictionary, options?) -> string                                  // ordered + framed
validate(msg: ParsedMessage, dictionary, options?) -> FixIssue[]
loadDictionary(json) -> Dictionary;  validateDictionary(json) -> FixIssue[];  extendDictionary(base, patch) -> Dictionary
tokenize(raw, soh?) -> Array<[tag: number, value: string]>;  calculateChecksum(s) -> string;  bodyLength(s) -> number
```
Design rules: **pure, deterministic** (no wall-clock, no randomness, no global state — caller
supplies timestamps/seq); **non-throwing** on the analyze path (everything is a returned
`FixIssue`); `string | Uint8Array` in/out via `TextEncoder`/`TextDecoder` (no `Buffer`);
`sideEffects:false`.

---

## Dictionary strategy (revised — generate the full spec from this repo)

- **Primary v0.1 source = the Markdown FIX 4.4 reference in `/Users/jifeon/projects/fix`.**
  `@boarteam/fix-codegen` parses `fields/` (type + Valid-values enum tables), `components/`,
  `messages/`, and `data-types.md` into one `DictionaryJSON` and emits it as
  `@boarteam/fix-dict-fix44`. The tables already encode everything the metamodel needs,
  verified against real files:
  - `| Tag | Field Name | Req'd | Comments |` rows → `MemberRef` with `reqd ∈ Y|N|C`.
  - Leading **`»`** → repeating-group membership; **`»»`** → nesting; the group's
    counter is the preceding `NoXxx` field; the **first `»` row is the group's boundary
    field** (spec states it: *"Must be the first field in this repeating group"*).
  - Rows with empty Tag + `<Component>` link → `ComponentDef` references (e.g.
    `<Standard Message Header>`, `<Instrument>`) the generator expands.
  - `data-types.md` → `DataTypeDef` (base type, `format_pattern`, `value_constraint`, ISO
    refs) driving `codec/datatypes.ts` value validators.
  - Conditional (`C`) and mutually-exclusive rules live as free-text in Comments → derive
    the **mechanical subset**, allow **hand-authored overrides**, declare the rest a coverage
    gap (honesty per the standard). The `erd-map` `MEMBER_CONDITION` annotations are an
    optional structured assist.
- **The generator only READS the Markdown and emits TS/JSON — it never writes back**, so the
  repo's CLAUDE.md "regeneration wipes annotations" gotcha does not apply. It must skip the
  leading `<!-- erd-map -->…<!-- /erd-map -->` block on each file.
- **QuickFIX `FIX44.xml` = canonical cross-check** (catch scraper drift; CI diff) and the
  path to **4.2/5.0** later.
- **boar-trading curated definitions = conformance oracle**, not the shipped data: the
  generated dictionary's MD/session messages must reconcile with the proven hand-authored
  structures (`messages.ts`, `components.ts`, `fields.ts`).
- **Custom/extended dictionaries** are first-class via `loadDictionary(json)` /
  `extendDictionary(base, patch)`; FIX Orchestra is the strategic post-0.1 source.

---

## What we reuse, refactor, add, and exclude

### Reuse (port the pure logic, with paths)
- **Checksum / framing** — `service.ts:37-61` (`buildMessagePart`, `calculateChecksum`,
  `addHeadersAndChecksum`) → `codec/checksum.ts` + `codec/encode.ts`. **Fix to byte math.**
- **Tokenizer** — SOH/`=` split + repeatable collection loop, `message-parser.ts:61-105`
  → `codec/tokenize.ts`, `SOH` as a parameter (drop the `FixProtocolService` coupling).
- **Metamodel concept** — the `TFixField | TFixGroup | TFixComponent` union
  (`fix-component.ts:5-24`) and the `allowedTags` tree-walk (`fix-component.ts:46-76`,
  `fix-message.ts:45-54`) → **reified as JSON data** (`GroupDef`/`ComponentDef`/`MemberRef`)
  and the `Dictionary` index builder.
- **Curated definitions** — `tags.ts`/`field-enums.ts`/`fields.ts`/`components.ts`/
  `messages.ts` → become the **conformance oracle** the generator is tested against (not the
  shipped dict).
- **Exception fields** — `exception.ts` (`refTagID/refSeqNum/refMsgType/sessionRejectReason`)
  → fields on `FixIssue` (demoted from thrown to returned).
- **Existing test assertions** — `fix-protocol.service.spec.ts` → ported with neutral fixtures.

### Refactor (the unification — the real work)
- Replace the **130-line per-MsgType `switch`** (`message-parser.ts:168-305`) and the flat
  `Partial<Record<Tags, any>>` output with **one dictionary-driven walker** producing a typed
  `ParsedMessage` with **properly nested repeating groups**.
- **Drop Joi** from the metamodel (`fix-component.ts:78-149`, `fix-message.ts:56-65`,
  inline `Joi.*` in `components.ts`) → pure `validate/*` over the JSON dictionary.
- Convert hand-coded `create*Message` builders (`service.ts:63-511`) into one generic
  **ordered encoder** driven by message member order; **strip** `getCurrentUTCTime()`,
  `sequenceNumber`, comp-ID lookups, and the `ProviderType` EXANTE/CTRADER switches.
- Remove `@nestjs/common` everywhere; remove the `TFixSessionSide` ACCEPTOR/INITIATOR
  throw-vs-warn asymmetry → a single `strict?` option.

### Add (net-new capabilities)
1. **Repeating-group reconstruction + emission** (`codec/groups.ts`) — *the missing piece*;
   nested groups too (`NoUnderlyings` > `NoLegs`), using the explicit first-field boundary
   from the dictionary (FIX has no group delimiters).
2. **Byte-accurate** checksum/BodyLength over UTF-8.
3. **Tokenizer `=`-in-value fix** (`indexOf('=')`, not `split('=')`).
4. **Real datatype coercion** (`codec/datatypes.ts`) — date/enum currently stubbed
   (`message-parser.ts:128-148`).
5. **Non-throwing structured diagnostics** across parse+validate.
6. **Group-count** (`NoXxx === len`) and **conditional (`C`)** presence validation.
7. **Multi-message framing** — split a buffer of concatenated messages (today only the first
   survives).
8. **`@boarteam/fix-codegen`** — Markdown spec → full FIX 4.4 dictionary (primary) +
   QuickFIX-XML cross-check; emits the `fix-dict-fix44` data files.
9. **Tooling/docs** per the standard — none exist today.

### Exclude (intentional, document as deliberate)
`session-manager.ts`, `module.ts`, `fix-client`/`fix-server`/`fix-providers` consumers; all
session state (seq numbers, heartbeats, side behavior, wall-clock); `ProviderType` branching;
`InternalInstrument`/`TSecurityLocator`/DB entities; Joi; NestJS; Loki; Node `net`/`Buffer`.

---

## Milestones (mapped to readiness Tiers)

> **Progress (updated 2026-06-22).** ✅ M0 · ✅ M1 · ✅ M2 · ✅ M3 · ✅ M4 · ⬜ v0.1.0 publish.
> Commits: M0 `b61b511` · M1 `12e5dd1` · M2 `0f459a0` · M3 `4686f2f` · M4 _(pending commit)_.
> **250 tests green**; build + `tsc --strict` + ESLint + Prettier + browser-env + bundle-safety
> all clean. M4 added the **QuickFIX `FIX44.xml` cross-check drift gate** (exact-signature
> allowlist baseline in `packages/fix-codegen/crosscheck-baseline.json`, hardened against a
> 24-finding adversarial review — incl. a critical optionality-regression hole), CI
> (Node 18/20/22 + DCO), Changesets, examples, TypeDoc, and the standard OSS docs. Status
> legend: ✅ done · 🔜 in progress / next · ⬜ todo.

- **✅ M0 — Clean-room extraction (Tier 0 gate).** Fresh repo, **Apache-2.0** LICENSE +
  NOTICE, **squashed initial commit** (no monorepo history). pnpm workspaces scaffold.
  **Store this plan in the repo** as `docs/PROJECT_PLAN.md` (the user's "store in the
  project" ask). Copy only pure pieces; scrub `InternalInstrument`/comp-IDs/venue names to
  neutral fixtures. **Right-to-publish cleared in writing**; `gitleaks detect
  --log-opts="--all"` clean. Smoke build + test **pass in an offline container**.
- **✅ M1 — Wire core + Dictionary contract + full-dict generator.** `codec/checksum`/`encode`/
  `tokenize`; Dictionary JSON `types.ts` + `Dictionary` runtime + `validateDictionary`; build
  **`@boarteam/fix-codegen` Markdown parser** producing the **full** `@boarteam/fix-dict-fix44`
  JSON from `/Users/jifeon/projects/fix`. Reconcile the generated MD/session messages against
  the boar-trading **oracle**. Unit tests: checksum vs known-good messages, round-trip framing,
  `validateDictionary` clean on the full dict.
- **✅ M2 — Parse with groups + datatypes.** Dictionary-driven `parse` → typed `ParsedMessage`
  with nested groups + diagnostics; `datatypes` coercion; multi-message framing. **Golden
  fixtures for the MD/session subset**, plus **round-trip smoke across all 93 messages**.
- **✅ M3 — Pure validator.** presence/enum/datatype/conditional → `FixIssue[]` (group-count
  consistency lives in `parse`/M2, since the counter scalar is not retained on `ParsedMessage`);
  **adversarial/fuzz suite** (truncated, reordered, bad-checksum, oversized, junk-tag)
  proving the parser **never crashes/hangs** (Tier-2 parser bar). Round-trip identity.
  Hardened against a 13-finding adversarial multi-agent review; `validate` is also exposed on
  `createFixEngine` and as a free function.
- **✅ M4 — Cross-check + DX/docs/packaging (Tier 1–2).** QuickFIX-`FIX44.xml` generator path
  + **CI diff vs the Markdown-generated dict** (drift gate). README (why-vs-alternatives,
  install, copy-paste example, `experimental`/0.x maturity + the subset-vs-full honesty
  note), TypeDoc, CHANGELOG/CONTRIBUTING/CODE_OF_CONDUCT/SECURITY, `examples/` kept green by
  CI. Enforce Prettier + ESLint + `tsc --strict` + Vitest in CI across **Node + a
  browser-like env**; bundle check asserts no `net`/`Buffer`/`crypto`/`joi`/`@nestjs` leak;
  Changesets for SemVer; Dependabot + audit + license-check; issue/PR templates; DCO.
- **⬜ v0.1.0 publish.** `@boarteam/fix` + `@boarteam/fix-dict-fix44`, SemVer 0.x with a
  **written breaking-change policy** (output shape / accepted input / issue codes).
- **Post-0.1 (deferred).** `dict-fix42`/`dict-fix50` via QuickFIX XML; `@boarteam/fix-cli`;
  FIX Orchestra source adapter; richer conditional rules; deeper conformance across the full
  93-message set — all behind the same public API.

---

## Top risks & mitigations
- **Repeating-group boundary detection** is the hardest new code (no delimiters). → explicit
  first-field metadata from the dictionary (the spec/`»` rows give it) + heavy adversarial
  fixtures.
- **Byte-accurate checksum changes output vs. the legacy module** (intentional). → golden
  tests; called out in CHANGELOG.
- **Dropping Joi** risks silent validation-coverage loss. → port existing Joi semantics as
  **test oracles** before cutover.
- **Markdown source drift** (CLAUDE.md warns the scraper can wipe annotations / drift). →
  QuickFIX XML as canonical cross-check with a **CI diff that fails on divergence**;
  regeneration must be idempotent.
- **Conditional (`C`) rules are free-text English.** → mechanical subset + hand overrides +
  declared coverage gap.
- **Ambition → never ships.** → engine correctness gated to the MD/session subset for v0.1;
  full dict ships as data with honest maturity labeling; versions/CLI/Orchestra deferred.
- **Tier-0 legal/secret.** → fresh squashed history, all-refs secret scan, written
  right-to-publish sign-off before first push.

---

## Verification (end-to-end)

1. **Tier-0 decoupling gate** — clean **offline** container:
   `pnpm install --offline && pnpm -r build && pnpm -r test` passes with no network/internal
   registry. `grep -ri "InternalInstrument\|exante\|ctrader\|skilling"` returns nothing;
   `gitleaks detect --log-opts="--all"` clean.
2. **Checksum/framing** — unit tests vs canonical FIX messages with known `10=` values
   (incl. a non-ASCII `Text` field to prove the byte fix).
3. **Dictionary generation** — `@boarteam/fix-codegen` produces a full FIX 4.4 dict;
   `validateDictionary` clean; **MD/session messages reconcile with the boar-trading oracle**;
   **Markdown-generated dict diffs empty (or explained) against the QuickFIX-XML dict**;
   regeneration idempotent.
4. **Golden parse** — the MD/session messages decode to expected nested structures (groups as
   arrays-of-objects, not parallel arrays); **all 93 messages round-trip** `encode(parse(x)) ≅ x`.
5. **Adversarial/fuzz** — malformed inputs produce `FixIssue[]` and **never throw/crash/hang**.
6. **Browser safety** — core tests green under happy-dom/jsdom; esbuild check fails if
   `net`/`Buffer`/`crypto`/`@nestjs`/`joi` appear in `@boarteam/fix` output.
7. **Standard sign-off** — walk the
   [pre-publish checklist](/Users/jifeon/projects/fix/docs/open-source-readiness.md#pre-publish-checklist)
   Tier 0–2 boxes before `npm publish`.

> **Naming.** Scope `@boarteam` is decided; package names (`@boarteam/fix`,
> `@boarteam/fix-dict-fix44`, `@boarteam/fix-codegen`) are proposals — confirm the
> `@boarteam` org exists on npm and the names are free before M4 publish.
