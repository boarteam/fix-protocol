# @boarteam/fix

A **dictionary-driven FIX protocol toolkit** for TypeScript — parse, validate, and encode
[FIX](https://www.fixtrading.org/) messages with **zero runtime dependencies**, in the browser
or Node. This is the engine; pair it with a dictionary such as
[`@boarteam/fix-dict-fix44`](https://www.npmjs.com/package/@boarteam/fix-dict-fix44).

On a 0.x line: the foundation is solid and well-tested, and the API may still refine ahead of
1.0. See the [project README](https://github.com/boarteam/fix-protocol#readme) for coverage,
testing, and the roadmap — [feedback](https://github.com/boarteam/fix-protocol/issues) welcome.

<!-- The GIF must use an absolute raw URL (npmjs.com does not resolve relative paths) pinned to
     the default branch. It 404s until `.github/demo.gif` exists on `main`, so do not publish a
     release pointing here before this lands on `main`. Source: .github/demo.tape. -->
<p align="center">
  <img src="https://raw.githubusercontent.com/boarteam/fix-protocol/main/.github/demo.gif" width="900" alt="Terminal recording of @boarteam/fix: a raw FIX 4.4 log line is piped in and decoded in stages into named, typed fields with its repeating group expanded into nested Bid/Offer objects, validating clean; then a corrupted message is piped in and still parses without throwing, returning the bad float, wrong checksum, and invalid enum as structured diagnostics. The same pure engine runs in a browser tab or Node.">
</p>

```ts
import { createFixEngine } from '@boarteam/fix';
import { dictionary } from '@boarteam/fix-dict-fix44';

const fix = createFixEngine(dictionary);
const { message, issues } = fix.parse(raw); // never throws; issues is FixIssue[]
const problems = fix.validate(message); // presence, enums, datatypes, conditional rules
const wire = fix.encode({
  msgType: 'D',
  fields: {/* ... */},
}); // ordered + framed
```

- **Stateless analyzer**, not a session/transport engine: no sockets, sequence numbers, or
  heartbeats — just the protocol.
- **Pure & deterministic**; **never throws** on the analyze path (diagnostics are returned
  data); **browser + Node** via `TextEncoder`/`TextDecoder`.

## Typed, self-rendering messages

`encode(EncodeMessage)` is the low-level primitive — an untyped, tag-keyed bag. For a
**statically-typed** encode side, the dictionary packages ship a `message` factory generated
from the same dictionary: creating a message for a `MsgType` yields a builder that knows only
that message's fields/groups and their value types, and renders **byte-identical** to `encode`.

```ts
import { message, MsgType } from '@boarteam/fix-dict-fix44';

const wire = message(MsgType.MarketDataSnapshotFullRefresh) // typed to this message's body
  .set('MDReqID', 'req-1')
  .set('Symbol', 'EURUSD')
  .set('NoMDEntries', [
    { MDEntryType: '0', MDEntryPx: '1.1050' }, // group entries are typed too
    { MDEntryType: '1', MDEntryPx: '1.1052' },
  ])
  .render({
    SenderCompID: 'ME',
    TargetCompID: 'YOU',
    MsgSeqNum: 1,
    SendingTime: '20260716-12:00:00',
  });
```

- **Value types come from the field datatype**: enumerated → the generated value union
  (`MDEntryType`); `Boolean` → `boolean`; numeric (`int`/`float`/`Price`/`Qty`/…) →
  `number | string` (the string is the exact-formatting escape hatch — a `number` float is
  rendered by `String()`, so pass a string when you need an exact form like `1.10`); everything
  else → `string`. Illegal fields, wrong value types, and malformed group entries are compile
  errors.
- **Transport/session-agnostic**: envelope fields (`MsgSeqNum`/`SenderCompID`/`SendingTime`/
  `TargetCompID`; framing `8`/`9`/`10` are computed) are supplied to `render(envelope)` — the
  library never holds a sequence counter, clock, or comp-IDs. The body type excludes them.
- **Mutable or immutable**: `message(...)` is a fast, fluent mutable builder for hot loops;
  `message.immutable(...)` (and `.toImmutable()`) is copy-on-write. Both accept a complete bulk
  init (`message('A', { EncryptMethod: 0, HeartBtInt: 30 })` — required keys must be named;
  `.assign({...})` stays partial) and double as a typed **read model** (`msg.get('Symbol')`,
  `msg.get('NoMDEntries')?.[0]?.MDEntryPx`) for deriving log metadata.
- **Absent values pass through**: an init/`set` value of `undefined`, `null`, or `''` is skipped
  at render and reads as unset — `message('A', { …, Username: username })` needs no
  `if (username)` guard, in the body, in group entries, and in the envelope alike. A required
  key can be deliberately left off the wire by naming it with `undefined` (dialect quirks); to
  force a literal empty value onto the wire, drop to the `encode` primitive.
- The engine façade mirrors it: `createFixEngine<MessageBodies>(dictionary).create(msgType)`.

**Narrowing an unknown message.** At a generic boundary — a `send(message: MessageView<any>)`,
a log-metadata helper — the concrete `MsgType` is erased, so `message.msgType === 'W'` cannot
narrow the body. A `Bodies`-bound type guard keyed on `msgType` restores it: the runtime is a
plain string compare, the typing comes from the `Bodies` registry. The engine binds one as
`engine.is`; the dict packages re-export a ready-made `isMessageType` (and a `MessageOf<M>` alias
for annotations), so no engine instance is needed. `messageTypeGuard<Bodies>()` builds a standalone
guard.

```ts
import { isMessageType, MsgType } from '@boarteam/fix-dict-fix44';
import type { MessageView } from '@boarteam/fix';

function logMeta(message: MessageView<any>) {
  if (isMessageType(message, MsgType.MarketDataSnapshotFullRefresh)) {
    // message: MessageView<MarketDataSnapshotFullRefreshBody> — get() is typed, no casts
    const securityID = message.get('SecurityID'); // string | undefined
    for (const entry of message.get('NoMDEntries') ?? []) {
      entry.MDEntryType; // MDFullGrp_NoMDEntriesEntry — entry fields typed
    }
  }
}
```

Both flavours narrow to the read surface `MessageView` (the interface the mutable and immutable
message share), not to the mutable/immutable _kind_ — the guard's purpose is typed reads, not
re-obtaining a builder.

**Venue extensions** (e.g. a broker's custom tags in an existing group) need no regenerated
dictionary: `extendDictionary(dictionary, ext)` adds them at runtime, and the generated,
per-container group/component `interface`s (`SecListGrp_NoRelatedSymEntry`, …) are augmentable —
patch the shared interface via declaration merging (single venue) or an override-interface
intersection (multiple venues), then rebind `messageFactory<MessageBodies>(extended)`. The
augmented type and the extended dictionary ship as a pair.

Full docs, examples, and the contribution guide are in the
[monorepo](https://github.com/boarteam/fix-protocol).

## FIX 5.0 SP2 / FIXT.1.1

FIX 5.0 splits the wire into a session protocol (tag 8 carries `FIXT.1.1`) and an
application version negotiated via `DefaultApplVerID(1137)` / per-message `ApplVerID(1128)`.
The engine models that split first-class — every codec entry point accepts either a single
dictionary or a **transport/application pair**:

```ts
import { createFixEngine } from '@boarteam/fix';
import { dictionary as fixt11 } from '@boarteam/fix-dict-fixt11';
import { dictionary as fix50sp2 } from '@boarteam/fix-dict-fix50sp2';

const fix = createFixEngine({ transport: fixt11, app: fix50sp2 });
const { message } = fix.parse(raw); // 8=FIXT.1.1 frames, SP2 bodies
for (const issue of fix.validate(message)) {
  // issue.layer: 'session' findings → answer with a Reject(3);
  //              'application' findings → a BusinessMessageReject(j).
}
```

Session (admin) messages are transport-owned — an application-only field on one is flagged
`validate/field-outside-layer` — and multi-version sessions route per message through an
optional `resolveApp(applVerID)` hook with a caller-supplied `defaultApplVerID` (the engine
holds no session state). Prefer a single dictionary? `@boarteam/fix-dict-fix50sp2` is the
pair pre-merged (a drop-in for `createFixEngine(dictionary)`), and
`mergeFixtDictionaries(transport, app)` builds the same shape from your own app-layer
dialect.

## API reference & `dist/api.json`

Every export is documented, signature by signature, in the generated
[API reference](https://boar.team/fix/docs/api/), and the tarball ships the model it is
rendered from: `dist/api.json` — export names, verbatim signatures, doc comments, source
positions, and the version each export first shipped in. The emitter gates this package's
own CI (doc coverage, `{@link}` integrity, SemVer-checked API diffs), so the model is held
to the code, not the other way round. Schema and guarantees:
[`docs/api-json.md`](https://github.com/boarteam/fix-protocol/blob/main/docs/api-json.md).

## License

[Apache-2.0](./LICENSE) © Boar Team. See [`NOTICE`](./NOTICE). "FIX" is a trademark of FIX
Protocol Limited; this is an independent project, not affiliated with or endorsed by it.
