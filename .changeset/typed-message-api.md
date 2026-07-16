---
'@boarteam/fix': minor
'@boarteam/fix-dict-fix44': minor
'@boarteam/fix-dict-fix42': minor
---

Typed, self-rendering Message API for the encode side: build a message for a `MsgType` and get a builder typed to only that message's fields/groups, rendering byte-identical to `encode`.

`@boarteam/fix` gains `messageFactory`, `createMessage`, `createImmutableMessage`, and the types `MessageView`/`MutableMessage`/`ImmutableMessage`/`MessageFactory`/`Envelope`/`UntypedBody`; `createFixEngine` becomes generic over a message-body registry and its result gains `create`/`createImmutable`. A Message carries a name-keyed body (which is also its typed read model via `get`/`has`) and `render(envelope)` produces complete framed wire — implemented over `encode`, so it is byte-identical to a hand-built `encode` of equivalent content. Both a mutable, fluent builder (`set`/`assign`/`delete`, for hot loops) and an immutable copy-on-write builder (`with`/`merge`/`without`) are provided, both accepting a whole body object. Session/header fields (`MsgSeqNum`/`SenderCompID`/`SendingTime`/`TargetCompID`; framing 8/9/10 computed) are supplied to `render` at call time, so the library holds no sequence counter, clock, or comp-IDs. On the untyped path it fails loud rather than silently dropping/corrupting data (unknown field name, a field not part of this message, a non-array group, a non-scalar on a scalar field).

The dict packages (`@boarteam/fix-dict-fix44`, `@boarteam/fix-dict-fix42`) additionally export a `message` factory bound to their dictionary, a `MessageBodies` registry (`MsgType` wire value → body type), a named body type per message (`NewOrderSingleBody`, …), and augmentable per-container group/component interfaces (`<Comp>Fields`, `<Container>_<Counter>Entry`). Field value types follow the datatype: enumerated → the value union (int/float enums widened with `| number` for the parsed numeric read-model); `Boolean` → `boolean`; numeric → `number | string`; `MultipleValueString` → `string`; else `string`.

Venue extensions need no regenerated dictionary: `extendDictionary` adds the tags at runtime, and the generated container-scoped interfaces are extended via declaration merging (single venue) or an override-interface intersection (multi-venue), then `messageFactory(extended)` rebinds — the augmented type and the extended dictionary travel as a pair.

Purely additive: `encode(EncodeMessage)`, the generated `Tags`/`MsgType`/`Enums`, and `DictionaryJSON` are unchanged.
