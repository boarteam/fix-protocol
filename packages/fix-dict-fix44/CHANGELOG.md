# @boarteam/fix-dict-fix44

## 0.1.0

### Patch Changes

- b9187e0: Add a QuickFIX `FIX44.xml` cross-check (drift gate) for the generated FIX 4.4 dictionary, plus
  v0.1 packaging and DX. The shipped dictionary is now diffed against the independently-maintained
  QuickFIX encoding on every CI run; all accepted differences are documented in
  `packages/fix-codegen/CROSSCHECK.md`. Adds a browser-environment (happy-dom) smoke test, a
  bundle-safety check that fails on any `net`/`Buffer`/`crypto`/`joi`/`@nestjs` leak, runnable
  examples kept green by CI, TypeDoc API docs, and contributor/security docs. No runtime API
  changes.
- Updated dependencies [b9187e0]
  - @boarteam/fix@0.1.0
