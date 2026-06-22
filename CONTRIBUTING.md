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

`packages/fix-dict-fix44/src/dictionary.json` and `index.ts` are **generated** by
`@boarteam/fix-codegen` from the FIX 4.4 Markdown reference. Do not edit them by hand.

```bash
# Requires the FIX 4.4 Markdown spec checked out (set FIX_SPEC_DIR or use --spec).
pnpm --filter @boarteam/fix-codegen generate
# Cross-check the generated dictionary against the vendored QuickFIX FIX44.xml:
pnpm crosscheck
```

The **cross-check drift gate** (`crosscheck.test.ts`) compares the shipped dictionary against
the independently-maintained QuickFIX `FIX44.xml`. Every accepted difference is documented in
`packages/fix-codegen/CROSSCHECK.md` and classified in `crosscheck.ts`. If your change moves a
difference out of its documented cluster, the gate fails — update the pinned allowlist (with a
reason) only when the divergence is genuinely expected.

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
