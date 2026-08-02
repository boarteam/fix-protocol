# CLAUDE.md

Guidance for Claude Code working in this repository (`@boarteam/fix` monorepo).

## Committing — read before every `git commit`

This repo enforces the **Developer Certificate of Origin**. CI runs a **DCO sign-off**
check that fails any PR commit lacking a `Signed-off-by:` trailer. So:

- **Always commit with `git commit -s`** (or `-s --amend` to fix an existing commit),
  which appends `Signed-off-by: <author name> <author email>` matching the commit author.
- If a DCO check has already failed, `git commit --amend -s --no-edit` then
  `git push --force-with-lease` on the PR branch fixes it.
- Commit messages follow **Conventional Commits** (`feat:`, `fix:`, `docs:`, `chore:`,
  with an optional scope like `feat(parse):`). See [`CONTRIBUTING.md`](./CONTRIBUTING.md)
  § "Commit sign-off (DCO)" for the human-facing version of both rules.

A `pre-commit` hook (simple-git-hooks → lint-staged → prettier) reformats staged files,
so expect a reformat pass on commit.

## Repo shape

pnpm workspace, vitest, TypeScript. Packages under `packages/`: `fix` (the engine),
`fix-dict-fix44` / `fix-dict-fix42` / `fix-dict-fix50sp2` / `fix-dict-fixt11` (generated
dictionary-data packages — the generator lives in the sibling `fix-codegen` repo; regenerate
rather than hand-editing `index.ts`). `fix-dict-fix50sp2` is the self-contained FIX 5.0 SP2
dict (FIXT.1.1 envelope + session messages + base-SP2 app messages, `applVerID: '9'`);
`fix-dict-fixt11` is the transport-only FIXT.1.1 dict.
Gates: `pnpm -r typecheck`, `pnpm test`, `pnpm lint`, `node scripts/check-bundle.mjs`
(browser-safety + bundle-size tripwires), and the FIX42 + FIX50SP2 drift crosschecks.
