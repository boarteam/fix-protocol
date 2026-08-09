# Contributing to `@boarteam/fix`

Thanks for your interest! This is an early (0.x) project; issues, fixes, and well-scoped
features are welcome. Please read this short guide first.

## Scope

`@boarteam/fix` is a **stateless FIX analyzer**: tokenize, parse, validate, encode, and the
dictionary runtime. It is intentionally **not** a session/transport engine — no sockets, no
sequence-number management, no heartbeats, no wall-clock. Contributions that add session or
transport behaviour are out of scope; analyzer/dictionary improvements are in scope.

## Development setup

This is a [pnpm](https://pnpm.io/) workspace ([Corepack](https://nodejs.org/api/corepack.html)
will pick up the pinned version from `packageManager`).

```bash
pnpm install
pnpm -r build      # tsup → ESM + CJS + d.ts (build first: cross-package tests import the built engine)
pnpm test          # vitest: Node suites + browser-like smoke + examples + cross-check drift gate
pnpm -r typecheck  # tsc --strict
pnpm lint          # eslint
pnpm format        # prettier --write   (pnpm format:check to verify)
pnpm check:bundle  # asserts the published bundles stay browser-safe (no net/Buffer/crypto/joi/@nestjs)
```

Formatting is automatic: `pnpm install` registers a pre-commit hook
([simple-git-hooks](https://github.com/toplenboren/simple-git-hooks) +
[lint-staged](https://github.com/lint-staged/lint-staged)) that runs Prettier on the files you
commit, so `format:check` can only fail in CI if the hook was bypassed (`git commit -n` or
`SKIP_SIMPLE_GIT_HOOKS=1`).

Before opening a PR, the full gate should be green:

```bash
pnpm -r build && pnpm -r typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm check:bundle
```

## The dictionaries are generated — never hand-edit them

Every dict package's `src/dictionary.json` and `src/index.ts` — in `fix-dict-fix44`,
`fix-dict-fix42`, `fix-dict-fix50sp2`, and `fix-dict-fixt11` — is **generated** from the
corresponding FIX specification sources and committed here as data. Do not edit them by hand.

The generator is maintained alongside the FIX spec, outside this repository. To change the
dictionary, regenerate it with that tooling and commit the reconciled result — open an issue if
you need a regeneration you can't produce yourself.

## Changesets (versioning)

Published packages (`@boarteam/fix` and the `@boarteam/fix-dict-*` dictionaries — `fix44`,
`fix42`, `fix50sp2`, `fixt11`) use
[Changesets](https://github.com/changesets/changesets). If your change affects any of them, add one:

```bash
pnpm changeset
```

Pre-1.0 SemVer: breaking changes to the **output shape**, **accepted input**, or **issue
codes** are a minor bump and must be called out in the changeset. See `CHANGELOG.md`.

Each package versions on its own changes. The dictionaries do **not** ride along with an engine
release: they declare `@boarteam/fix` as a peer dependency over the whole pre-1.0 line
(`">=0.5.0 <1.0.0"`), which every engine release stays inside, so releasing the engine leaves
them untouched. Name a dictionary in your changeset only when that dictionary actually changed
— including when an engine change breaks it. (Changesets would otherwise force a **major** bump
on every peer dependent of a released package; `onlyUpdatePeerDependentsWhenOutOfRange` in
`.changeset/config.json` limits that to peers whose range the new version actually leaves.
When the engine does reach 1.0, that major bump fires as intended — check the Version Packages
PR, which rewrites the peer range to a bare `>=1.0.0`, and restore the upper bound by hand.)

## Releasing (maintainers)

Releases are automated by the [Release workflow](.github/workflows/release.yml) using the
Changesets action:

1. Merge PRs that include changesets into `main`.
2. The workflow opens a **"chore(release): version packages"** PR that consumes the changesets,
   bumps versions, and updates the changelogs.
3. Merging that PR builds and **publishes to npm** (with provenance) and creates the git tags
   and GitHub releases.

This requires an `NPM_TOKEN` repository secret — an npm **automation/granular** token with
publish rights to the `@boarteam` scope (automation tokens bypass 2FA, so no OTP is needed).
A manual fallback is `pnpm -r build && pnpm -r publish --otp=<code>`.

## Commit sign-off (DCO)

All commits must be signed off under the
[Developer Certificate of Origin](https://developercertificate.org/). Add the trailer with:

```bash
git commit -s -m "fix(parse): ..."
```

This appends `Signed-off-by: Your Name <you@example.com>`, certifying you have the right to
submit the contribution under the project's license. CI enforces this on every PR commit.

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/)
(`feat:`, `fix:`, `docs:`, `chore:`, with an optional scope like `feat(parse):`).

## Documentation

User-facing documentation — the guides, the generated API reference, the issue-code catalogue,
the playground and the browsable dictionary reference — lives at
<https://boar.team/fix/docs/>. Two parts of it are produced **from this repository**, so they are
contributed here:

- **The [API reference](https://boar.team/fix/docs/api/)** is rendered from `dist/api.json`, which
  the `packages/fix` build extracts from the TSDoc comments on the public exports. Improving an
  export's docs means editing its doc comment in `packages/fix/src` — CI already fails on an
  undocumented export or a broken `{@link}`. See [`docs/api-json.md`](docs/api-json.md).
- **The [diagnostics catalogue](https://boar.team/fix/diagnostics/)** lists every issue code the
  engine ships; the list itself comes from the released package, so a new or renamed code lands
  there automatically (the site's build fails until its prose covers it).

The prose guides are authored in the site's own repository. If one is wrong or missing something,
open an [issue](https://github.com/boarteam/fix-protocol/issues) here and we will route it.

## Reporting bugs & security issues

Use the issue templates for bugs and features. For **security vulnerabilities**, do not open a
public issue — follow [`SECURITY.md`](SECURITY.md).

By contributing, you agree your contributions are licensed under the project's
[Apache-2.0](LICENSE) license.
