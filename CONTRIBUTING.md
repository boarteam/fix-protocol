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

Before opening a PR, the full gate should be green:

```bash
pnpm -r build && pnpm -r typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm check:bundle
```

## The dictionary is generated — never hand-edit it

`packages/fix-dict-fix44/src/dictionary.json` and `index.ts` are **generated** from the FIX 4.4
specification and committed here as data. Do not edit them by hand.

The generator is maintained alongside the FIX spec, outside this repository. To change the
dictionary, regenerate it with that tooling and commit the reconciled result — open an issue if
you need a regeneration you can't produce yourself.

## Changesets (versioning)

Published packages (`@boarteam/fix`, `@boarteam/fix-dict-fix44`) use
[Changesets](https://github.com/changesets/changesets). If your change affects either, add one:

```bash
pnpm changeset
```

Pre-1.0 SemVer: breaking changes to the **output shape**, **accepted input**, or **issue
codes** are a minor bump and must be called out in the changeset. See `CHANGELOG.md`.

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

## Reporting bugs & security issues

Use the issue templates for bugs and features. For **security vulnerabilities**, do not open a
public issue — follow [`SECURITY.md`](SECURITY.md).

By contributing, you agree your contributions are licensed under the project's
[Apache-2.0](LICENSE) license.
