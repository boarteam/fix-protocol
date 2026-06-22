# @boarteam/fix-dict-fix42

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
