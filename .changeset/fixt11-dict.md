---
'@boarteam/fix-dict-fixt11': major
---

Initial release: the FIXT.1.1 transport-layer dictionary as data — the session envelope (a
strict superset of the FIX 4.4 header, adding `ApplVerID(1128)`, `CstmApplVerID(1129)`,
`ApplExtID(1156)` and the `HopGrp`) plus the 7 session messages, with `Logon` requiring
`DefaultApplVerID(1137)` both in the dictionary and in the generated `LogonBody` type.
Generated from the QuickFIX/J `FIXT11.xml` data dictionary with Apache-2.0 FIX Orchestra
session-layer descriptions. Pair it with an application dictionary via the engine's
`FixtDictionaries` support, or use `@boarteam/fix-dict-fix50sp2` for the batteries-included
merged form. `XMLnonFIX(n)` is deliberately not shipped (see README).
