# Vendored QuickFIX `FIX44.xml`

`FIX44.xml` is a FIX 4.4 data dictionary from the [QuickFIX](https://quickfixengine.org/)
project, vendored here as a build-time **cross-check** source for `@boarteam/fix-codegen`.

## Provenance

- **Source:** the `FIX44.xml` bundled with the QuickFIX distribution (taken from a local
  install at `share/quickfix/FIX44.xml`).
- **SHA-256:** `bf1954733e3d9a16293f90139fb95aa8bc49cd41b9663131fb5fb1e77593b78f`
- **Lines:** 6593. Vendored **verbatim** (byte-for-byte) from that distribution.

> Note: QuickFIX's `FIX44.xml` has drifted across forks/versions over time (e.g. the `Hops`
> header group, component naming). This copy is treated as a fixed reference; the accepted
> differences versus the shipped dictionary are pinned in
> [`../../crosscheck-baseline.json`](../../crosscheck-baseline.json). To refresh it, replace
> this file, re-run `pnpm --filter @boarteam/fix-codegen crosscheck --write-baseline`, review
> the baseline diff, and update the SHA-256 above.

## Why it is here

The shipped FIX 4.4 dictionary (`@boarteam/fix-dict-fix44`) is generated from the B2BITS
FIXopaedia Markdown reference. QuickFIX's XML is an independently-maintained encoding of the
same protocol, so diffing the two catches scraper drift in the Markdown pipeline. See
`../../src/crosscheck.ts` and the generated `../../CROSSCHECK.md`.

## Scope of use / redistribution

- Used **only at build/test time** by `@boarteam/fix-codegen`, which is **private and never
  published** to npm (`"private": true`).
- **Not bundled into** the published packages (`@boarteam/fix`, `@boarteam/fix-dict-fix44`).

## License & attribution

QuickFIX and its data dictionaries are distributed by quickfixengine.org under the QuickFIX
Software License (a permissive, BSD/Apache-style license). This file is included unmodified;
its copyright (© quickfixengine.org and contributors) and license terms are retained by their
respective owners and are **not** superseded by this repository's Apache-2.0 license. If you
redistribute this file, retain this acknowledgment.

"FIX" is a trademark of FIX Protocol Limited; this project is independent and not affiliated
with or endorsed by FIX Protocol Limited or the QuickFIX project.
