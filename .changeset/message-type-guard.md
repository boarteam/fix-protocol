---
'@boarteam/fix': minor
'@boarteam/fix-dict-fix44': minor
'@boarteam/fix-dict-fix42': minor
---

A `msgType` type guard for the typed Message API: narrow a message of unknown type — a `MessageView<any>`, e.g. at a generic `send(message)` boundary — to a specific message's body, so `get`/`has` become typed to that message with no casts.

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
