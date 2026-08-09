# @boarteam/fix-dict-fix44

## 4.0.1

### Patch Changes

- 693014e: Stop the dictionaries from taking a major bump on every engine release.

  Each dictionary declared `@boarteam/fix` as `workspace:^`, published as `^0.5.0` — a range that
  in 0.x admits patches only. Every engine minor therefore left it, and Changesets bumps a peer
  dependent whose range is left to **major**, so the dictionaries climbed a major per engine
  release (`fix44` reached 4.0.0 against an engine at 0.5.0) carrying nothing but an "Updated
  dependencies" line.

  The peer range now spans the whole pre-1.0 engine line — `">=0.5.0 <1.0.0"` — so an engine
  release stays inside it, and `onlyUpdatePeerDependentsWhenOutOfRange` limits the forced major to
  peers whose range a new version actually leaves. From here each dictionary versions on its own
  changes: a regenerated dictionary, a new export, a corrected field — or an engine change that
  genuinely breaks it, which gets its own changeset. Published data, types, and exports are
  unchanged; the only difference in the tarball is the wider peer range.

- 22e859c: Point readers at the documentation site.

  Every package now advertises <https://boar.team/fix/docs/> as its `homepage` (npm renders it as
  the package's primary link) and opens its README with a docs / API-reference / playground row.
  The engine README gains a section listing the six guides, the generated API reference, the issue-code
  diagnostics catalogue and the browsable FIX dictionary reference; each dictionary README links the
  reference view for its own dialect. Docs-only — no code, types, or dictionary data changed.

## 4.0.0

### Patch Changes

- Updated dependencies [769679e]
  - @boarteam/fix@0.5.0

## 3.0.0

### Patch Changes

- 3e57f43: Typed guard-free message inits (`MessageInit`) and a uniform absence rule.

  BREAKING (0.x minor):

  - `message(msgType, init)`, `engine.create/createImmutable`, and `createMessage/createImmutableMessage` now take `MessageInit<B>`: when an init object is passed, dictionary-required keys must be named (pass `undefined` to deliberately omit one — the escape hatch for dialects that skip a "required" tag). Omitting `init` entirely keeps the lenient incremental-building path.
  - The absence rule is now uniform: `undefined`, `null`, and `''` are skipped at render (body, repeating-group entries, and envelope), `has()` reports them absent, and `get()` normalizes a stored `null` to `undefined`. Previously `''` rendered as an empty `tag=` value (malformed FIX); callers who need a literal empty value can use the low-level `encode` primitive.

  Additive:

  - Every init/`set`/`with` value — including fields inside repeating-group entries — additionally accepts `null | undefined`, so possibly-absent values pass straight through without `if (x) msg.set(...)` guards. `assign`/`merge` take `Partial<MessageInit<B>>` (no required-key demand). `Envelope` values accept `null | undefined` for conditional session fields (`SenderSubID`, …). `toJSON()` is typed as the stored init shape. New exported types: `MessageInit`, `FieldInit`.

  The dict packages have no source change; they are republished so their peer range accepts the new `@boarteam/fix` version.

- Updated dependencies [3e57f43]
- Updated dependencies [3e57f43]
  - @boarteam/fix@0.4.0

## 2.0.0

### Minor Changes

- 202087e: A `msgType` type guard for the typed Message API: narrow a message of unknown type — a `MessageView<any>`, e.g. at a generic `send(message)` boundary — to a specific message's body, so `get`/`has` become typed to that message with no casts.

  `@boarteam/fix` gains `messageTypeGuard` and the types `MessageTypeGuard`/`MessageOf`; a `createFixEngine<MessageBodies>(...)` engine gains `is(message, msgType)` — the same guard with the body registry already bound. The dict packages (`@boarteam/fix-dict-fix44`, `@boarteam/fix-dict-fix42`) export a ready-made `isMessageType` bound to their `MessageBodies`, plus a one-argument `MessageOf<M>` alias for annotating a narrowed message — so no engine instance is needed:

  ```ts
  import { isMessageType, MsgType } from '@boarteam/fix-dict-fix44';

  if (isMessageType(message, MsgType.MarketDataSnapshotFullRefresh)) {
    const securityID = message.get('SecurityID'); // string | undefined
    for (const entry of message.get('NoMDEntries') ?? []) {
      entry.MDEntryPx; // group entries typed too
    }
  }
  ```

  The guard is pure and dictionary-agnostic at runtime — a plain `msgType` string compare; the narrowing comes entirely from the `MessageBodies` registry at compile time. It narrows to the read surface `MessageView` (shared by the mutable and immutable message), not the mutable/immutable kind.

  Purely additive: existing `message`/`createFixEngine`/`messageFactory` behaviour and the generated `Tags`/`MsgType`/`Enums`/`MessageBodies` are unchanged.

- afec2d6: Typed, self-rendering Message API for the encode side: build a message for a `MsgType` and get a builder typed to only that message's fields/groups, rendering byte-identical to `encode`.

  `@boarteam/fix` gains `messageFactory`, `createMessage`, `createImmutableMessage`, and the types `MessageView`/`MutableMessage`/`ImmutableMessage`/`MessageFactory`/`Envelope`/`UntypedBody`; `createFixEngine` becomes generic over a message-body registry and its result gains `create`/`createImmutable`. A Message carries a name-keyed body (which is also its typed read model via `get`/`has`) and `render(envelope)` produces complete framed wire — implemented over `encode`, so it is byte-identical to a hand-built `encode` of equivalent content. Both a mutable, fluent builder (`set`/`assign`/`delete`, for hot loops) and an immutable copy-on-write builder (`with`/`merge`/`without`) are provided, both accepting a whole body object. Session/header fields (`MsgSeqNum`/`SenderCompID`/`SendingTime`/`TargetCompID`; framing 8/9/10 computed) are supplied to `render` at call time, so the library holds no sequence counter, clock, or comp-IDs. On the untyped path it fails loud rather than silently dropping/corrupting data (unknown field name, a field not part of this message, a non-array group, a non-scalar on a scalar field).

  The dict packages (`@boarteam/fix-dict-fix44`, `@boarteam/fix-dict-fix42`) additionally export a `message` factory bound to their dictionary, a `MessageBodies` registry (`MsgType` wire value → body type), a named body type per message (`NewOrderSingleBody`, …), and augmentable per-container group/component interfaces (`<Comp>Fields`, `<Container>_<Counter>Entry`). Field value types follow the datatype: enumerated → the value union (int/float enums widened with `| number` for the parsed numeric read-model); `Boolean` → `boolean`; numeric → `number | string`; `MultipleValueString` → `string`; else `string`.

  Venue extensions need no regenerated dictionary: `extendDictionary` adds the tags at runtime, and the generated container-scoped interfaces are extended via declaration merging (single venue) or an override-interface intersection (multi-venue), then `messageFactory(extended)` rebinds — the augmented type and the extended dictionary travel as a pair.

  Purely additive: `encode(EncodeMessage)`, the generated `Tags`/`MsgType`/`Enums`, and `DictionaryJSON` are unchanged.

### Patch Changes

- Updated dependencies [202087e]
- Updated dependencies [afec2d6]
  - @boarteam/fix@0.3.0

## 1.0.0

### Minor Changes

- 08197a6: New enum exports: per-field consts/types, an `Enums` aggregate, and a same-name `MsgType` value-union type.

  Every enumerated field is now a top-level export: a const map of spec value name → on-the-wire string plus a same-name value-union type (`Side.BUY === '1'` in FIX 4.4; `side: Side` works in type positions). Values are wire-verbatim strings even for int-typed fields, so they compare directly against tokenizer and parser output.

  `Enums` aggregates the same maps by field name (`Enums.MDEntryType.BID === '0'` in FIX 4.4, `Enums.MDEntryType.Bid` in FIX 4.2), each entry referencing the top-level const — no data duplication; `EnumFieldName` is the union of enumerated field names. The one exception is the field `MsgType` (tag 35): its name belongs to the message-type map, so it gets no top-level const and stays reachable as `Enums.MsgType`. (The generator's reserved-name policy also defensively skips any field name that isn't a valid TS identifier.)

  `MsgType` (the message-type map) is now also exported as a same-name type (const/type declaration merge): the union of wire values (`'A' | '0' | ...`), the value-side counterpart of `MsgTypeName`. Consumers can write `msgType: MsgType` in type positions, and a bare `export { MsgType }` re-export carries both the const and the type — the same holds for every per-field const.

- 40d75a5: Add `TagNames` and `MsgTypeNames` reverse lookup maps: tag number → field name and MsgType value → message name, derived from the generated `Tags`/`MsgType` maps. Useful for log lines and session-level Reject construction without loading the full dictionary.

### Patch Changes

- Updated dependencies [3e22e93]
- Updated dependencies [e3737df]
  - @boarteam/fix@0.2.0

## 0.2.0

### Minor Changes

- 1f1dd16: Regenerate the dictionaries from permissively-licensed sources and re-source all descriptions under a license that permits redistribution.

  - **FIX 4.4** is now generated from the QuickFIX `FIX44.xml` data dictionary (QuickFIX Software License). Its conditional-required (`C`) presence markings are restored from a prose-free facts overlay derived from the published FIX 4.4 specification.
  - **Descriptions are re-sourced from the Apache-2.0 FIX Orchestra `orchestrations` project** (`OrchestraFIX44.xml` / `OrchestraFIX42.xml`) for both FIX 4.4 and FIX 4.2, replacing the previously-bundled specification prose. The runtime engine never read descriptions, so this is a data-only change with no behavioural impact on parse/validate/encode.
  - **Breaking (data shape):** the FIX 4.4 dictionary now follows QuickFIX naming/factoring conventions — message names lose spacing (e.g. `MarketDataSnapshotFullRefresh`), a few fields are renamed (e.g. `IOIid` → `IOIID`), datatypes use their canonical FIX names, and components are factored more granularly (26 → 105). Decoded wire output is unchanged; the `Tags` / `MsgType` / component-name keys may differ, so pin and review on upgrade.
  - `NOTICE` files updated with QuickFIX and FIX Orchestra (Apache-2.0) attribution and corrected provenance.

## 0.1.0

### Patch Changes

- b9187e0: Add a QuickFIX `FIX44.xml` cross-check (drift gate) for the generated FIX 4.4 dictionary, plus
  v0.1 packaging and DX. The shipped dictionary is now diffed against the independently-maintained
  QuickFIX encoding on every CI run; all accepted differences are documented in
  `packages/fix-codegen/CROSSCHECK.md`. Adds a browser-environment (happy-dom) smoke test, a
  bundle-safety check that fails on any `net`/`Buffer`/`crypto`/`joi`/`@nestjs` leak, runnable
  examples kept green by CI, TypeDoc API docs, and contributor/security docs. No runtime API
  changes.
- Updated dependencies [b9187e0]
  - @boarteam/fix@0.1.0
