# @boarteam/fix-dict-fix42

## 0.2.0

### Minor Changes

- 1f1dd16: Regenerate the dictionaries from permissively-licensed sources and re-source all descriptions under a license that permits redistribution.

  - **FIX 4.4** is now generated from the QuickFIX `FIX44.xml` data dictionary (QuickFIX Software License). Its conditional-required (`C`) presence markings are restored from a prose-free facts overlay derived from the published FIX 4.4 specification.
  - **Descriptions are re-sourced from the Apache-2.0 FIX Orchestra `orchestrations` project** (`OrchestraFIX44.xml` / `OrchestraFIX42.xml`) for both FIX 4.4 and FIX 4.2, replacing the previously-bundled specification prose. The runtime engine never read descriptions, so this is a data-only change with no behavioural impact on parse/validate/encode.
  - **Breaking (data shape):** the FIX 4.4 dictionary now follows QuickFIX naming/factoring conventions — message names lose spacing (e.g. `MarketDataSnapshotFullRefresh`), a few fields are renamed (e.g. `IOIid` → `IOIID`), datatypes use their canonical FIX names, and components are factored more granularly (26 → 105). Decoded wire output is unchanged; the `Tags` / `MsgType` / component-name keys may differ, so pin and review on upgrade.
  - `NOTICE` files updated with QuickFIX and FIX Orchestra (Apache-2.0) attribution and corrected provenance.

## 0.1.0

### Minor Changes

- Add `@boarteam/fix-dict-fix42`: the complete FIX 4.2 dictionary as data (405 fields / 46
  messages / 21 datatypes), generated from the official FIX 4.2 specification (FIX Repository,
  2010 Edition) and cross-checked against the QuickFIX `FIX42.xml` dictionary. Its message
  structures match QuickFIX exactly, with only documented naming/enum deltas.

  `@boarteam/fix`: the validator now recognizes the FIX 4.2 datatype spellings `UTCDate` and
  `MonthYear` as aliases of `UTCDateOnly` and `month-year`, so date/period fields are
  format-validated across dialects. Purely additive; FIX 4.4 behavior is unchanged.

### Patch Changes

- Updated dependencies
  - @boarteam/fix@0.1.1
