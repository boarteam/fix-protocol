---
'@boarteam/fix-dict-fix44': minor
'@boarteam/fix-dict-fix42': minor
'@boarteam/fix-dict-fix50sp2': minor
'@boarteam/fix-dict-fixt11': minor
---

Every dictionary package now ships the inbound counterparts of its encode-side
`isMessageType`/`MessageOf` pair:

- `isInboundType` — the `MessageBodies`-bound narrowing guard for a **received** message.
  Unlike the encode-side guard it narrows the inbound view, so `envelope` and `parsed`
  survive the narrowing.
- `InboundOf<M>` — the annotation alias for a message already narrowed to one `MsgType`,
  with `msgType` pinned to the literal.

Until now a consumer reading messages had to bind these itself
(`inboundTypeGuard<MessageBodies>()`, `InboundOf<MessageBodies, M>`) while the write side
came ready-bound — and `@boarteam/fix`'s own documentation already said dict packages
re-export `isInboundType`. This closes that gap.

Additive: nothing existing changed, and the dictionary data is byte-identical (only the
generated `index.ts` surface grew). `inboundKnownGuard` is deliberately **not** re-exported —
it takes the dictionary at runtime, so an app with a dictionary extension must bind its own
rather than borrow one bound to the stock dictionary.
