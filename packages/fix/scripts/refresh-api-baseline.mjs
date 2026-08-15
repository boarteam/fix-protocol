#!/usr/bin/env node
/* Maintenance for the API contract files. Runs AUTOMATICALLY as the tail of
 * the root `version-packages` script, so the changesets "Version Packages" PR
 * carries the refreshed baseline and no post-release chore PR is needed (see
 * docs/api-json.md § Release-time maintenance). Kept runnable by hand for
 * recovery:
 *
 *   1. api/baseline.json becomes the just-released structural surface, so the
 *      next PR diffs against the version users actually have;
 *   2. api/since.json entries recorded as "next" freeze to the released
 *      version, so they stop tracking package.json.
 *
 * Reads the CURRENT build output — run `pnpm --filter @boarteam/fix build`
 * first, from the released commit.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractSurface, structuralOf } from './api-model.mjs';

const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(PKG_DIR, 'package.json'), 'utf8'));

const { symbols, problems } = extractSurface();
if (problems.length) {
  console.error(`[api] cannot refresh baseline — extraction problems:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}

writeFileSync(
  join(PKG_DIR, 'api', 'baseline.json'),
  JSON.stringify(
    {
      note: 'Structural API of the last published release — regenerate with scripts/refresh-api-baseline.mjs after each release.',
      version: pkg.version,
      symbols: structuralOf(symbols),
    },
    null,
    2,
  ) + '\n',
);

const sincePath = join(PKG_DIR, 'api', 'since.json');
const since = JSON.parse(readFileSync(sincePath, 'utf8'));
let frozen = 0;
for (const [name, version] of Object.entries(since)) {
  if (version === 'next') {
    since[name] = pkg.version;
    frozen++;
  }
}
writeFileSync(sincePath, JSON.stringify(since, null, 2) + '\n');

/* Prettier-format the outputs so a no-op refresh is byte-identical to the
 * committed files — the version-packages chain must not churn the release PR
 * with formatting-only diffs. */
execFileSync(
  'pnpm',
  ['exec', 'prettier', '--write', join(PKG_DIR, 'api', 'baseline.json'), sincePath],
  {
    stdio: 'ignore',
  },
);

console.log(
  `[api] baseline refreshed to ${pkg.version} (${symbols.length} symbols)` +
    (frozen ? ` · ${frozen} since entr${frozen === 1 ? 'y' : 'ies'} frozen to ${pkg.version}` : ''),
);
