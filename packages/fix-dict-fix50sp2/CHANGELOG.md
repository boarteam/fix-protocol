# @boarteam/fix-dict-fix50sp2

## 2.0.1

### Patch Changes

- 693014e: Stop the dictionaries from taking a major bump on every engine release.

  Each dictionary declared `@boarteam/fix` as `workspace:^`, published as `^0.5.0` — a range that
  in 0.x admits patches only. Every engine minor therefore left it, and Changesets bumps a peer
  dependent whose range is left to **major**, so the dictionaries climbed a major per engine
  release (`fix44` reached 4.0.0 against an engine at 0.5.0) carrying nothing but an "Updated
  dependencies" line.

  The peer range now spans the whole pre-1.0 engine line — `">=0.5.0 <1.0.0"` — so an engine
  release stays inside it, and `onlyUpdatePeerDependentsWhenOutOfRange` limits the forced major to
  peers whose range a new version actually leaves. From here each dictionary versions on its own
  changes: a regenerated dictionary, a new export, a corrected field — or an engine change that
  genuinely breaks it, which gets its own changeset. Published data, types, and exports are
  unchanged; the only difference in the tarball is the wider peer range.

- 22e859c: Point readers at the documentation site.

  Every package now advertises <https://boar.team/fix/docs/> as its `homepage` (npm renders it as
  the package's primary link) and opens its README with a docs / API-reference / playground row.
  The engine README gains a section listing the six guides, the generated API reference, the issue-code
  diagnostics catalogue and the browsable FIX dictionary reference; each dictionary README links the
  reference view for its own dialect. Docs-only — no code, types, or dictionary data changed.

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
