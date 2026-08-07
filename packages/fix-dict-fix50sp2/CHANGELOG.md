# @boarteam/fix-dict-fix50sp2

## 2.0.0

### Patch Changes

- Updated dependencies [769679e]
  - @boarteam/fix@0.5.0

## 1.0.0

### Major Changes

- 3e57f43: Initial release: the complete FIX 5.0 SP2 dictionary as data, self-contained over FIXT.1.1
  — the FIXT session envelope (`ApplVerID(1128)`, required Logon `DefaultApplVerID(1137)`),
  the 7 session messages, and the 108 base-SP2 application messages (1,452 fields / 176
  components / 28 datatypes; `version: 'FIX.5.0SP2'`, `beginString: 'FIXT.1.1'`,
  `applVerID: '9'`). Generated from the QuickFIX/J `FIX50SP2.xml` + `FIXT11.xml` data
  dictionaries with Apache-2.0 FIX Orchestra descriptions (99.9% field coverage), and
  cross-checked against quickfix-go's independently-maintained SP2 dictionary by a CI drift
  gate. Ships the full typed message API, including a `LogonBody` that requires
  `DefaultApplVerID` at the type level.

### Patch Changes

- Updated dependencies [3e57f43]
- Updated dependencies [3e57f43]
  - @boarteam/fix@0.4.0
