# @boarteam/fix-dict-fixt11

The **FIXT.1.1 transport-layer dictionary as data** (74 fields / 7 session messages / 4
components) for the [`@boarteam/fix`](https://www.npmjs.com/package/@boarteam/fix) engine.
FIXT.1.1 is the session protocol that carries FIX 5.0+ application messages: the standard
header/trailer (a strict superset of the FIX 4.4 envelope, adding `ApplVerID(1128)`,
`CstmApplVerID(1129)`, `ApplExtID(1156)`), plus the session messages — Heartbeat(0),
TestRequest(1), ResendRequest(2), Reject(3), SequenceReset(4), Logout(5), and Logon(A)
with its required `DefaultApplVerID(1137)`. Generated from the QuickFIX/J `FIXT11.xml`
data dictionary — never hand-maintained.

📖 **[Documentation](https://boar.team/fix/docs/)** · 🔀 **[The FIXT pair API](https://boar.team/fix/docs/dictionaries/)** · ▶️ **[Playground](https://boar.team/fix/playground/)** · 💻 **[GitHub](https://github.com/boarteam/fix-protocol)**

Use it for transport-layer tooling (session-message construction and validation, layer
attribution) or pair it with an application dictionary. For a batteries-included FIX 5.0
SP2 dictionary that already contains this envelope, use
[`@boarteam/fix-dict-fix50sp2`](https://www.npmjs.com/package/@boarteam/fix-dict-fix50sp2).

```ts
import { createFixEngine } from '@boarteam/fix';
import { dictionary, message, Enums } from '@boarteam/fix-dict-fixt11';

const fix = createFixEngine(dictionary);
// A typed FIXT Logon: DefaultApplVerID(1137) is REQUIRED by the LogonBody type.
const wire = message('A')
  .set('EncryptMethod', '0')
  .set('HeartBtInt', 30)
  .set('DefaultApplVerID', Enums.ApplVerID.FIX50SP2) // '9'
  .render({
    SenderCompID: 'ME',
    TargetCompID: 'YOU',
    MsgSeqNum: 1,
    SendingTime: '20260801-12:00:00',
  });
```

Exports: `dictionary` (the data; `version === beginString === 'FIXT.1.1'`),
`Tags`/`TagNames`, `MsgType`/`MsgTypeNames`, `Enums` (e.g. `Enums.ApplVerID`,
`Enums.SessionRejectReason`), a top-level const + same-name type per enumerated field,
`DICTIONARY_VERSION`, and the typed message API (`message`, `MessageBodies` with the 7
admin bodies, `isMessageType`, `MessageOf<M>`).

## Provenance & coverage

- **Structure:** QuickFIX/J `FIXT11.xml` (vendored at a pinned commit; provenance and
  SHA-256 recorded in the generator repo). Header: 30 members including the `HopGrp`
  (`NoHops`) component; trailer: `SignatureLength`/`Signature`/`CheckSum`.
- **Descriptions:** FIX Orchestra `FIXTSession.xml` (`FIX.5.0SP2_EP247`, Apache-2.0).
  73/74 fields are documented; `MsgType(35)` enumerates the full FIX 5.0 message-type
  code set but only the session-layer codes carry session-layer descriptions (recorded in
  `dictionary.coverageGaps`).
- **Known limitation:** `XMLnonFIX(n)` is deliberately **not shipped**: QuickFIX/J master
  comments it out and quickfix-go omits it entirely; only quickfix C++ ships it. Restoring
  it later is additive (a minor release); shipping it now and dropping it later would be
  breaking. Messages carrying `35=n` parse flat with a `parse/unknown-msgtype` issue.

Requires `@boarteam/fix` as a peer dependency.

## License

[Apache-2.0](./LICENSE) © Boar Team. See [`NOTICE`](./NOTICE) and
[`THIRD-PARTY-NOTICES.txt`](./THIRD-PARTY-NOTICES.txt) (QuickFIX Software License for the
structural source; Apache-2.0 FIX Orchestra for descriptions). "FIX" is a trademark of FIX
Protocol Limited; this is an independent project, not affiliated with or endorsed by it.
