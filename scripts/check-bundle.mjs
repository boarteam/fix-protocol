#!/usr/bin/env node
// Browser-safety gate for the published packages.
//
// `@boarteam/fix` and the `@boarteam/fix-dict-*` dictionaries promise zero runtime dependencies
// and a browser+Node surface. This script bundles each package's *published* ESM output for the
// browser with esbuild and fails if:
//   1. esbuild cannot produce a browser bundle (a Node built-in leaked into the import graph
//      — `node:net`, `node:crypto`, etc. are unresolvable on the browser platform), or
//   2. the bundle text references a forbidden API (`Buffer`, `joi`, `@nestjs`, a Node
//      built-in import), which would betray the zero-dep / browser claim.
//
// Run after `pnpm -r build`.

import { build } from 'esbuild';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

// `maxKB` is a bloat tripwire, not a promise: it fails the gate if a bundle grows well past
// its expected size (e.g. a dictionary accidentally inlined twice, or a dependency creeping
// in). Sized at roughly 1.4x the current bundle; raise deliberately when the dictionary
// legitimately grows.
const targets = [
  { name: '@boarteam/fix', entry: 'packages/fix/dist/index.js', maxKB: 150 },
  { name: '@boarteam/fix-dict-fix44', entry: 'packages/fix-dict-fix44/dist/index.js', maxKB: 1300 },
  { name: '@boarteam/fix-dict-fix42', entry: 'packages/fix-dict-fix42/dist/index.js', maxKB: 550 },
  {
    name: '@boarteam/fix-dict-fix50sp2',
    entry: 'packages/fix-dict-fix50sp2/dist/index.js',
    maxKB: 1900,
  },
  {
    name: '@boarteam/fix-dict-fixt11',
    entry: 'packages/fix-dict-fixt11/dist/index.js',
    maxKB: 120,
  },
];

// Patterns that must never appear in browser-facing output.
const FORBIDDEN = [
  { label: 'Node built-in import', re: /(from|require\(|import\()\s*['"]node:[a-z/]+['"]/ },
  {
    label: 'bare Node-builtin import',
    re: /(from|require\()\s*['"](net|tls|dns|http|https|crypto|fs|os|child_process)['"]/,
  },
  { label: 'Buffer', re: /\bBuffer\b/ },
  { label: 'crypto', re: /\bcrypto\.(subtle|randomBytes|createHash|createHmac)\b/ },
  { label: 'joi', re: /(from|require\()\s*['"]joi['"]/ },
  { label: '@nestjs', re: /@nestjs\// },
];

let failed = false;

for (const { name, entry, maxKB } of targets) {
  const abs = new URL(entry, `file://${root}`).pathname;
  if (!existsSync(abs)) {
    console.error(`✗ ${name}: missing build output ${entry} — run \`pnpm -r build\` first`);
    failed = true;
    continue;
  }

  let result;
  try {
    result = await build({
      entryPoints: [abs],
      bundle: true,
      platform: 'browser',
      format: 'esm',
      write: false,
      logLevel: 'silent',
      // No `external`: resolving every import is the point — a Node built-in would error.
    });
  } catch (err) {
    console.error(`✗ ${name}: failed to bundle for the browser (a Node dependency leaked):`);
    console.error(
      `  ${String(err.message ?? err)
        .split('\n')
        .slice(0, 4)
        .join('\n  ')}`,
    );
    failed = true;
    continue;
  }

  const text = result.outputFiles.map((f) => f.text).join('\n');
  const hits = FORBIDDEN.filter(({ re }) => re.test(text)).map(({ label }) => label);
  if (hits.length > 0) {
    console.error(`✗ ${name}: forbidden references in browser bundle: ${hits.join(', ')}`);
    failed = true;
  } else if (maxKB !== undefined && text.length / 1024 > maxKB) {
    console.error(
      `✗ ${name}: browser bundle is ${(text.length / 1024).toFixed(0)} KB, over the ${maxKB} KB tripwire — ` +
        'raise maxKB in scripts/check-bundle.mjs if the growth is intentional',
    );
    failed = true;
  } else {
    const kb = (text.length / 1024).toFixed(0);
    console.log(`✓ ${name}: clean browser bundle (${kb} KB, zero Node/Buffer/joi/@nestjs)`);
  }
}

if (failed) {
  console.error('\nBundle safety check failed.');
  process.exit(1);
}
console.log('\nBundle safety check passed.');
