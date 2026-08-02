# @boarteam/fix

## 0.4.0

### Minor Changes

- 3e57f43: FIX 5.0 SP2 / FIXT.1.1 support. `parse`/`parseAll`/`encode`/`validate`/`createFixEngine` now
  also accept a FIXT transport/application dictionary pair (`FixtDictionaries`): parsing and
  encoding run over the pair's merged view (tag 8 carries the transport's `FIXT.1.1`), and
  `validate` attributes every finding to a layer (`FixIssue.layer: 'session' | 'application'`)
  so callers can choose between a session `Reject(3)` and a `BusinessMessageReject(j)` — with a
  session-layer purity check (`validate/field-outside-layer`) flagging application-only fields
  on admin messages. An optional `resolveApp(applVerID)` hook routes multi-version sessions by
  per-message `ApplVerID(1128)` with a caller-supplied `defaultApplVerID` (the engine still
  holds no session state). Also new: `mergeFixtDictionaries(transport, app)` (the documented
  single-dictionary convenience), `DictionaryJSON.applVerID` + `Dictionary.applVerID` (the
  ApplVerID code a FIXT-era dictionary answers to), and named-format validation for the FIX 5.0
  datatypes (`TZTimestamp`, `TZTimeOnly`, `LocalMktTime`, `Language`).
- 3e57f43: Typed guard-free message inits (`MessageInit`) and a uniform absence rule.

  BREAKING (0.x minor):

  - `message(msgType, init)`, `engine.create/createImmutable`, and `createMessage/createImmutableMessage` now take `MessageInit<B>`: when an init object is passed, dictionary-required keys must be named (pass `undefined` to deliberately omit one — the escape hatch for dialects that skip a "required" tag). Omitting `init` entirely keeps the lenient incremental-building path.
  - The absence rule is now uniform: `undefined`, `null`, and `''` are skipped at render (body, repeating-group entries, and envelope), `has()` reports them absent, and `get()` normalizes a stored `null` to `undefined`. Previously `''` rendered as an empty `tag=` value (malformed FIX); callers who need a literal empty value can use the low-level `encode` primitive.

  Additive:

  - Every init/`set`/`with` value — including fields inside repeating-group entries — additionally accepts `null | undefined`, so possibly-absent values pass straight through without `if (x) msg.set(...)` guards. `assign`/`merge` take `Partial<MessageInit<B>>` (no required-key demand). `Envelope` values accept `null | undefined` for conditional session fields (`SenderSubID`, …). `toJSON()` is typed as the stored init shape. New exported types: `MessageInit`, `FieldInit`.

  The dict packages have no source change; they are republished so their peer range accepts the new `@boarteam/fix` version.

## 0.3.0

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

## 0.2.0

### Minor Changes

- 3e22e93: Dictionary extensibility: `extendDictionary(base, ...extensions)` merges venue extension declarations (new fields, enum values, components, messages, and placements into existing structures — including repeating groups behind components) into a fresh `DictionaryJSON`, plus the one-declaration bridge `defineExtension`/`tagsOf`/`msgTypesOf` that drives the typed maps from the same declaration.

  New stable issue codes (`extend/*` family, emitted by `extendDictionary`; severity encodes the outcome — error = skipped/reverted, warning = applied but review, info = advisory): `extend/field-tag-collision`, `extend/field-name-collision`, `extend/field-bad-tag`, `extend/field-unknown-type`, `extend/tag-outside-user-range`, `extend/data-length-unwired`, `extend/enum-unknown-field`, `extend/enum-value-conflict`, `extend/component-collision`, `extend/component-cycle`, `extend/msgtype-collision`, `extend/message-name-collision`, `extend/header-trailer-injected`, `extend/header-trailer-missing`, `extend/target-not-found`, `extend/unknown-member`, `extend/member-not-found`, `extend/duplicate-member`, `extend/counter-not-marked`, `extend/counter-as-field`, `extend/group-delimiter-shift`, `extend/ambiguous-boundary`, `extend/unresolvable-group-delimiter`, `extend/data-length-not-placed`, `extend/delimiter-defined`, `extend/component-fanout`, `extend/invalid-spec`.

  `DictionaryJSON` gains an optional `extensions?: string[]` provenance field listing applied extension ids. Placements are append/after-anchor only and guarded against delimiter shifts and nested-scope boundary ambiguity; applying an extension twice is a no-op. Requires TypeScript ≥ 5.0 for the literal-typing bridge.

- e3737df: New typed map helpers for extending dictionaries with venue-specific tags: `extendTags`, `invertTags`, `extendMsgTypes`, `invertMsgTypes`, plus the exported result types `ExtendTags`, `InvertTags`, `ExtendMsgTypes`, `InvertMsgTypes`.

  The helpers merge/invert the literal `Tags`/`MsgType` maps shipped by the dict packages while preserving exact literal typing (`Tags.SymbolName` hovers as `1007`; reverse maps give literal lookups for known tags plus the shipped `name | undefined` index fallback). Pure, total, zero runtime dependencies; TypeScript ≥ 5.0 required for `const` type parameters. No new issue codes.

## 0.1.1

### Patch Changes

- Add `@boarteam/fix-dict-fix42`: the complete FIX 4.2 dictionary as data (405 fields / 46
  messages / 21 datatypes), generated from the official FIX 4.2 specification (FIX Repository,
  2010 Edition) and cross-checked against the QuickFIX `FIX42.xml` dictionary. Its message
  structures match QuickFIX exactly, with only documented naming/enum deltas.

  `@boarteam/fix`: the validator now recognizes the FIX 4.2 datatype spellings `UTCDate` and
  `MonthYear` as aliases of `UTCDateOnly` and `month-year`, so date/period fields are
  format-validated across dialects. Purely additive; FIX 4.4 behavior is unchanged.

## 0.1.0

### Patch Changes

- b9187e0: Add a QuickFIX `FIX44.xml` cross-check (drift gate) for the generated FIX 4.4 dictionary, plus
  v0.1 packaging and DX. The shipped dictionary is now diffed against the independently-maintained
  QuickFIX encoding on every CI run; all accepted differences are documented in
  `packages/fix-codegen/CROSSCHECK.md`. Adds a browser-environment (happy-dom) smoke test, a
  bundle-safety check that fails on any `net`/`Buffer`/`crypto`/`joi`/`@nestjs` leak, runnable
  examples kept green by CI, TypeDoc API docs, and contributor/security docs. No runtime API
  changes.
