---
'@boarteam/fix': minor
---

New typed map helpers for extending dictionaries with venue-specific tags: `extendTags`, `invertTags`, `extendMsgTypes`, `invertMsgTypes`, plus the exported result types `ExtendTags`, `InvertTags`, `ExtendMsgTypes`, `InvertMsgTypes`.

The helpers merge/invert the literal `Tags`/`MsgType` maps shipped by the dict packages while preserving exact literal typing (`Tags.SymbolName` hovers as `1007`; reverse maps give literal lookups for known tags plus the shipped `name | undefined` index fallback). Pure, total, zero runtime dependencies; TypeScript ≥ 5.0 required for `const` type parameters. No new issue codes.
