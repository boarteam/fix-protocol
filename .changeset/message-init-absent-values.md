---
'@boarteam/fix': minor
'@boarteam/fix-dict-fix44': patch
'@boarteam/fix-dict-fix42': patch
---

Typed guard-free message inits (`MessageInit`) and a uniform absence rule.

BREAKING (0.x minor):

- `message(msgType, init)`, `engine.create/createImmutable`, and `createMessage/createImmutableMessage` now take `MessageInit<B>`: when an init object is passed, dictionary-required keys must be named (pass `undefined` to deliberately omit one — the escape hatch for dialects that skip a "required" tag). Omitting `init` entirely keeps the lenient incremental-building path.
- The absence rule is now uniform: `undefined`, `null`, and `''` are skipped at render (body, repeating-group entries, and envelope), `has()` reports them absent, and `get()` normalizes a stored `null` to `undefined`. Previously `''` rendered as an empty `tag=` value (malformed FIX); callers who need a literal empty value can use the low-level `encode` primitive.

Additive:

- Every init/`set`/`with` value — including fields inside repeating-group entries — additionally accepts `null | undefined`, so possibly-absent values pass straight through without `if (x) msg.set(...)` guards. `assign`/`merge` take `Partial<MessageInit<B>>` (no required-key demand). `Envelope` values accept `null | undefined` for conditional session fields (`SenderSubID`, …). `toJSON()` is typed as the stored init shape. New exported types: `MessageInit`, `FieldInit`.

The dict packages have no source change; they are republished so their peer range accepts the new `@boarteam/fix` version.
