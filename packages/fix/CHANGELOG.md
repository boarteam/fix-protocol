# @boarteam/fix

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
