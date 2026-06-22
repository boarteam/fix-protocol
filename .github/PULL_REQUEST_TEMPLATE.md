<!-- Thanks for contributing to @boarteam/fix! -->

## What & why

<!-- A short description of the change and the motivation. Link any issue: Closes #123. -->

## Type of change

- [ ] Bug fix (parse/validate/encode/dictionary)
- [ ] New feature
- [ ] Docs / examples
- [ ] Tooling / CI
- [ ] Breaking change (output shape, accepted input, or issue codes — see SECURITY/CHANGELOG policy)

## Checklist

- [ ] `pnpm -r build && pnpm -r typecheck` pass
- [ ] `pnpm lint && pnpm format:check` pass
- [ ] `pnpm test` passes (Node + browser-like env, examples)
- [ ] `pnpm check:bundle` passes (no `net`/`Buffer`/`crypto`/`joi`/`@nestjs` in published output)
- [ ] Added a Changeset if this changes a published package (`pnpm changeset`)
- [ ] Dictionary data (`fix-dict-fix44`) was **regenerated** with the spec tooling, not hand-edited
- [ ] Commits are signed off (`git commit -s`) per the DCO — see CONTRIBUTING.md

## Notes for reviewers

<!-- Anything that needs special attention, trade-offs, or follow-ups. -->
