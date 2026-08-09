# @boarteam/fix-dict-fix50sp2

The **complete FIX 5.0 SP2 dictionary as data** (1,452 fields / 115 messages / 28 datatypes),
self-contained over the **FIXT.1.1** transport, for the
[`@boarteam/fix`](https://www.npmjs.com/package/@boarteam/fix) engine. The FIXT session
envelope (header/trailer, `ApplVerID(1128)`, `DefaultApplVerID(1137)`) plus the 7 session
messages and the 108 base-SP2 application messages in one dictionary — a drop-in for the
same single-dictionary API the 4.2/4.4 dicts use. Generated from the QuickFIX/J
`FIX50SP2.xml` + `FIXT11.xml` data dictionaries and cross-checked against quickfix-go's
independently-maintained `FIX50SP2.xml` by a CI drift gate — never hand-maintained.

📖 **[Documentation](https://boar.team/fix/docs/)** · 📚 **[Browse FIX 5.0 SP2](https://boar.team/fix/dialect/5-0-sp2/)** · ▶️ **[Playground](https://boar.team/fix/playground/)** · 💻 **[GitHub](https://github.com/boarteam/fix-protocol)**

FIX 5.0 messages travel over FIXT.1.1: tag 8 carries `FIXT.1.1`, and the application
version rides on `DefaultApplVerID(1137)` (required on Logon; `9` = FIX 5.0 SP2) with the
optional per-message header override `ApplVerID(1128)`. This dictionary models exactly
that: `dictionary.version === 'FIX.5.0SP2'`, `dictionary.beginString === 'FIXT.1.1'`,
`dictionary.applVerID === '9'`.

```ts
import { createFixEngine } from '@boarteam/fix';
import { dictionary, message, Enums } from '@boarteam/fix-dict-fix50sp2';

const fix = createFixEngine(dictionary);
// A FIXT Logon, typed: DefaultApplVerID is required by the LogonBody type.
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
// wire starts "8=FIXT.1.1|9=..."
```

Exports: `dictionary` (the data), `Tags`/`TagNames`, `MsgType`/`MsgTypeNames`, `Enums`
(e.g. `Enums.ApplVerID.FIX50SP2 === '9'`), a top-level const + same-name type per
enumerated field, `DICTIONARY_VERSION` (`'FIX.5.0SP2'` — the _application_ version; tag 8
carries `dictionary.beginString`, `'FIXT.1.1'`), and the typed message API: `message`,
`MessageBodies` (admin + application bodies), `isMessageType`, `MessageOf<M>`.

## Provenance & coverage

- **Structure:** QuickFIX/J `FIX50SP2.xml` (base SP2: 108 messages — deliberately _not_
  the quickfix C++ copy, which was regenerated at EP280 and is effectively FIX Latest) +
  `FIXT11.xml` (envelope + 7 session messages), merged at build time.
- **Descriptions:** FIX Orchestra `OrchestraFIXLatest.xml` (EP307) for the application
  layer + `FIXTSession.xml` (EP247) for the session layer, both Apache-2.0. Coverage:
  99.9% of fields, 99.7% of enum values; the remainder is recorded in
  `dictionary.coverageGaps`.
- **Cross-check:** compared structurally against quickfix-go's `FIX50SP2.xml` (a later EP
  level: 110 messages / 198 components); the reviewed EP-drift differences are pinned in a
  committed baseline and CI fails on any _new_ drift.
- **Known limitations:** `XMLnonFIX(n)` is not shipped (QuickFIX/J master comments it out
  and quickfix-go omits it; restoring it later is additive). No conditional-required (`C`)
  markings — the only historical source of `C` facts is license-restricted, so like the
  4.2 dict all members are `Y`/`N` (see the project README's coverage notes).

Requires `@boarteam/fix` as a peer dependency.

## License

[Apache-2.0](./LICENSE) © Boar Team. See [`NOTICE`](./NOTICE) and
[`THIRD-PARTY-NOTICES.txt`](./THIRD-PARTY-NOTICES.txt) (QuickFIX Software License for the
structural sources; Apache-2.0 FIX Orchestra for descriptions). "FIX" is a trademark of FIX
Protocol Limited; this is an independent project, not affiliated with or endorsed by it.
