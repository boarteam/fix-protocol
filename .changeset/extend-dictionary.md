---
'@boarteam/fix': minor
---

Dictionary extensibility: `extendDictionary(base, ...extensions)` merges venue extension declarations (new fields, enum values, components, messages, and placements into existing structures — including repeating groups behind components) into a fresh `DictionaryJSON`, plus the one-declaration bridge `defineExtension`/`tagsOf`/`msgTypesOf` that drives the typed maps from the same declaration.

New stable issue codes (`extend/*` family, emitted by `extendDictionary`; severity encodes the outcome — error = skipped/reverted, warning = applied but review, info = advisory): `extend/field-tag-collision`, `extend/field-name-collision`, `extend/field-bad-tag`, `extend/field-unknown-type`, `extend/tag-outside-user-range`, `extend/data-length-unwired`, `extend/enum-unknown-field`, `extend/enum-value-conflict`, `extend/component-collision`, `extend/component-cycle`, `extend/msgtype-collision`, `extend/message-name-collision`, `extend/header-trailer-injected`, `extend/header-trailer-missing`, `extend/target-not-found`, `extend/unknown-member`, `extend/member-not-found`, `extend/duplicate-member`, `extend/counter-not-marked`, `extend/counter-as-field`, `extend/group-delimiter-shift`, `extend/ambiguous-boundary`, `extend/unresolvable-group-delimiter`, `extend/data-length-not-placed`, `extend/delimiter-defined`, `extend/component-fanout`, `extend/invalid-spec`.

`DictionaryJSON` gains an optional `extensions?: string[]` provenance field listing applied extension ids. Placements are append/after-anchor only and guarded against delimiter shifts and nested-scope boundary ambiguity; applying an extension twice is a no-op. Requires TypeScript ≥ 5.0 for the literal-typing bridge.
