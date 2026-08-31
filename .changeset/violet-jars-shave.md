---
'@boarteam/fix': minor
---

Add the inbound read view: `toInbound` turns a `ParsedMessage` into a typed, name-keyed `InboundMessage`.

The typed message API was write-only. `message(MsgType.X, …)` gives a name-keyed body pinned by
the generated `MessageBodies`, but `parse` hands back a tag-keyed `ParsedMessage` whose `msgType`
is a bare `string` — so reading a received message meant a hand-written `switch (msgType)` and a
tag→field mapper per message, re-deriving what the dictionary already knows.

`toInbound(parsed, dict)` closes that: it re-keys the parse result by dictionary name (groups
become arrays of entry objects under their counter's name), splits the standard header/trailer
into a typed `envelope`, and returns a `MessageView` that `inboundTypeGuard<MessageBodies>()`
narrows per `MsgType` — the mirror image of the builder on the way out. It never throws, never
re-parses, and keeps the original `ParsedMessage` reachable for byte-faithful re-encoding.

`msgType` also becomes a usable discriminant. `InboundUnion<MessageBodies>` is every message in
one union keyed on `msgType`, so `switch (message.msgType)` narrows each `case` to that message's
body — with `default` exhaustively `never` when you handle everything, and live and typed when you
handle a subset. An unknown `MsgType` cannot be a member of that union (a `msgType: string` member
overlaps every literal and makes `get()` uncallable in every branch), so `inboundKnownGuard`
separates it out first — which matches how it parses anyway: an unrecognised `MsgType` is read
flat, with no groups reconstructed.

- `toInbound`, `InboundMessage`, `InboundMessageOf`, `InboundEnvelope`, `InboundBody`
- `inboundTypeGuard`, `InboundTypeGuard`, `InboundOf`
- `InboundUnion`, `inboundKnownGuard`, `InboundKnownGuard`
- `FixEngine.inbound()` / `.isInbound` / `.isKnown` on the engine façade
- `Dictionary.envelopeTags()` — the header/trailer tag set, detected structurally, matching the
  exclusion the code generator applies when emitting `MessageBodies`
