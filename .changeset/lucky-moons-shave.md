---
'@boarteam/fix': minor
---

`InboundMessage`'s body type parameter now defaults to `any`, so an unnarrowed received
message is spelled `InboundMessage` instead of `InboundMessage<any>`.

This only adds spellings: every existing `InboundMessage<X>` still means what it did, and
narrowing is unaffected — a guard still _replaces_ the body type rather than intersecting
with it. It brings the type in line with both ends of its own lifecycle, which already
default `B` the same way (`toInbound`, `FixEngine.inbound`) or already spell `<any>`
themselves (`InboundTypeGuard`, `InboundKnownGuard`). The write-side views keep no default
on purpose: there you always know what you are building.

The API-diff gate also learns that adding a type-parameter default is additive rather than
an alteration, since it cannot break a caller.
