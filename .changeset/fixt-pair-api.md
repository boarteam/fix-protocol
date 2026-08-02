---
'@boarteam/fix': minor
---

FIX 5.0 SP2 / FIXT.1.1 support. `parse`/`parseAll`/`encode`/`validate`/`createFixEngine` now
also accept a FIXT transport/application dictionary pair (`FixtDictionaries`): parsing and
encoding run over the pair's merged view (tag 8 carries the transport's `FIXT.1.1`), and
`validate` attributes every finding to a layer (`FixIssue.layer: 'session' | 'application'`)
so callers can choose between a session `Reject(3)` and a `BusinessMessageReject(j)` — with a
session-layer purity check (`validate/field-outside-layer`) flagging application-only fields
on admin messages. An optional `resolveApp(applVerID)` hook routes multi-version sessions by
per-message `ApplVerID(1128)` with a caller-supplied `defaultApplVerID` (the engine still
holds no session state). Also new: `mergeFixtDictionaries(transport, app)` (the documented
single-dictionary convenience), `DictionaryJSON.applVerID` + `Dictionary.applVerID` (the
ApplVerID code a FIXT-era dictionary answers to), and named-format validation for the FIX 5.0
datatypes (`TZTimestamp`, `TZTimeOnly`, `LocalMktTime`, `Language`).
