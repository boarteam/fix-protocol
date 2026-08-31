# @boarteam/fix

A **dictionary-driven FIX protocol toolkit** for TypeScript — parse, validate, and encode
[FIX](https://www.fixtrading.org/) messages with **zero runtime dependencies**, in the browser
or Node. This is the engine; pair it with a dictionary such as
[`@boarteam/fix-dict-fix44`](https://www.npmjs.com/package/@boarteam/fix-dict-fix44).

📖 **[Documentation](https://boar.team/fix/docs/)** · 🧭 **[API reference](https://boar.team/fix/docs/api/)** · ▶️ **[Playground](https://boar.team/fix/playground/)** · 💻 **[GitHub](https://github.com/boarteam/fix-protocol)**

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

## Reading an inbound message

The same per-message types work on the way **in**. `parse` returns a faithful but tag-keyed
`ParsedMessage` (`message.fields[262].value`, groups under `message.groups[268]`), which is the
right shape for a codec and the wrong one for application code — it leaves you writing a
`switch (msgType)` and a tag-to-field mapper per message, re-deriving what the dictionary
already knows. `toInbound` re-keys it by name, so a received message reads the way a built one
does.

```ts
import { inboundKnownGuard, loadDictionary, parse, toInbound } from '@boarteam/fix';
import { dictionary as fix44, MsgType, type MessageBodies } from '@boarteam/fix-dict-fix44';

// The dict packages ship the dictionary as data; `parse` wants it indexed.
const dictionary = loadDictionary(fix44);
const isKnownInbound = inboundKnownGuard<MessageBodies>(dictionary);

const { message, issues } = parse(raw, dictionary); // gate on `issues` first
const inbound = toInbound(message, dictionary);

inbound.envelope.MsgSeqNum; // the session envelope, before narrowing

if (isKnownInbound(inbound)) {
  switch (
    inbound.msgType // narrows per case
  ) {
    case MsgType.Logon:
      inbound.get('HeartBtInt'); // typed to LogonBody
      break;
    case MsgType.MarketDataSnapshotFullRefresh:
      inbound.get('NoMDEntries')?.[0]?.MDEntryPx; // the typed entry array
      break;
    default:
      break; // known, but not handled here
  }
}
```

- **Body by name, envelope on the side.** Repeating groups are arrays of entry objects under
  their counter's name (`NoMDEntries`, `NoRelatedSym`) — the declared counter is not a property,
  because the entry array _is_ the count. Header/trailer fields land on `envelope`, matching the
  body types, which exclude them by construction. Which tags count as envelope is decided by the
  dictionary's header/trailer components (`Dictionary.envelopeTags()`), not by a fixed list.
- **`switch (inbound.msgType)` narrows** once `isKnownInbound` has run. The guard is not
  ceremony: an unrecognised `MsgType` cannot be a member of the message union — a `msgType:
string` member overlaps every literal, so no `case` eliminates it and its loose `get` makes
  every branch uncallable — and it does not parse like one either, being read flat with no groups
  reconstructed. `inboundTypeGuard` is the single-MsgType `if` form. Handle every message and
  `default` narrows to `never`; handle a subset and it stays live and typed.
- **It is a `MessageView`**, so a received message also renders: `inbound.render(envelope)`
  re-emits the body under a fresh envelope — the useful shape for a proxy that re-signs what it
  forwards. For a byte-exact echo, go through `toEncodeMessage(inbound.parsed)` instead:
  `ParsedField.raw` is the round-trip source of truth, and a body carries the coerced value.
- **Nothing is re-parsed or re-validated.** `toInbound` is a pure re-keying of what `parse`
  produced; every diagnostic was already reported there, and `validate()` still runs against the
  `ParsedMessage`, which stays reachable as `inbound.parsed`.
- The engine façade mirrors it: `createFixEngine<MessageBodies>(dictionary)` binds `.inbound()`,
  `.isInbound` and `.isKnown`.

One deliberate sharp edge: the body type of an un-narrowed inbound message is `any`, not a loose
index-signature type. A generated body is an `interface`, and TypeScript never gives an interface
an implicit index signature — so no loose type is ever its supertype, and a guard narrowing _to_
one would silently produce an intersection whose loose `get` overload wins at every call site.
`InboundBody` is exported for callers who mean not to narrow; pass it explicitly.

Examples and the contribution guide live in the
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

## Documentation

The full documentation is at **[boar.team/fix/docs](https://boar.team/fix/docs/)** — guides for
[parsing](https://boar.team/fix/docs/parse/), [validation](https://boar.team/fix/docs/validate/),
[encoding](https://boar.team/fix/docs/encode/),
[typed messages](https://boar.team/fix/docs/typed-messages/),
[dictionary extensions](https://boar.team/fix/docs/extend/) and
[choosing a dictionary](https://boar.team/fix/docs/dictionaries/). Every sample on those pages is
compiled and executed against the released package at build time, so they cannot drift from what
you install. Alongside them: a [catalogue of every issue code](https://boar.team/fix/diagnostics/)
`parse` and `validate` can emit, a browser
[playground](https://boar.team/fix/playground/) running this engine client-side, and a browsable
[FIX dictionary reference](https://boar.team/fix/).

### API reference & `dist/api.json`

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
