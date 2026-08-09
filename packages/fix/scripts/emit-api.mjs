#!/usr/bin/env node
/* Emit dist/api.json — the API model consumers render from — and hold the
 * public surface to its contract while doing it. Runs as part of `pnpm build`
 * for this package (after tsup), so every PR that touches the surface meets
 * the gates in CI:
 *
 *   - doc coverage: an exported symbol, member, function parameter or return
 *     without TSDoc fails — the full surface, no report-only tier left;
 *   - link integrity: every {@link} must resolve (see docs/api-json.md);
 *   - grouping: every export placed in exactly one curated group (api/groups.json);
 *   - since: every export has an entry in api/since.json ('next' = unreleased);
 *   - API diff: structural changes against api/baseline.json (the last
 *     published release) must be covered by the version bump already in
 *     package.json or by a pending changeset — additions need at least a
 *     minor, removals/alterations a major.
 *
 * Deterministic: no clock, no randomness — rebuild twice, diff nothing.
 * See docs/api-json.md for the schema contract and the release-time
 * maintenance step (scripts/refresh-api-baseline.mjs).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  extractSurface,
  sourcePositions,
  checkLinks,
  checkDocCoverage,
  diffAgainstBaseline,
  pendingChangesetLevel,
  versionDelta,
  extractExamples,
  exampleAnnotations,
  LEVEL,
} from './api-model.mjs';

const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

const fail = (problems) => {
  console.error(`\n[api] EMIT FAILED — ${problems.length} problem(s):`);
  for (const p of problems.slice(0, 40)) console.error('  ' + p);
  if (problems.length > 40) console.error(`  ... and ${problems.length - 40} more`);
  process.exit(1);
};

const pkg = readJson(join(PKG_DIR, 'package.json'));
const groups = readJson(join(PKG_DIR, 'api', 'groups.json'));
const since = readJson(join(PKG_DIR, 'api', 'since.json'));
const baseline = readJson(join(PKG_DIR, 'api', 'baseline.json'));

const { symbols, problems } = extractSurface();

/* ------------------------------------------------------------- the gates */

const coverage = checkDocCoverage(symbols);
problems.push(...coverage.problems);
problems.push(...checkLinks(symbols));

/* @example blocks are executable claims: shape-checked here, EXECUTED by
 * examples/api-doctest.test.ts (the repo's test gate). Both must hold for the
 * emitted `examplesVerified` flag to mean anything. */
const doctest = extractExamples(symbols);
problems.push(...doctest.problems);
for (const example of doctest.examples) {
  if (exampleAnnotations(example.code).length === 0) {
    problems.push(
      `${example.id}: no \`// → \` output annotations — an example must assert what it prints`,
    );
  }
}

const grouped = new Map();
for (const group of groups) {
  for (const name of group.symbols) {
    if (grouped.has(name))
      problems.push(`${name} is in groups ${grouped.get(name)} and ${group.id}`);
    grouped.set(name, group.id);
    if (!symbols.some((s) => s.id === name)) {
      problems.push(`api/groups.json lists ${name} (${group.id}), which is not an export`);
    }
  }
}
for (const s of symbols) {
  if (!grouped.has(s.id))
    problems.push(`export ${s.id} is not in api/groups.json — place it (curation, not guessing)`);
}

for (const s of symbols) {
  if (!(s.id in since)) {
    problems.push(
      `export ${s.id} has no api/since.json entry — add "${s.id}": "next" (or the version that shipped it)`,
    );
  }
}
for (const name of Object.keys(since)) {
  if (!symbols.some((s) => s.id === name)) {
    problems.push(
      `api/since.json entry ${name} is not an export — delete it (or declare the rename in the baseline flow)`,
    );
  }
}

const diff = diffAgainstBaseline(symbols, baseline);
const allowed =
  LEVEL[versionDelta(baseline.version, pkg.version)] >= LEVEL[pendingChangesetLevel()]
    ? versionDelta(baseline.version, pkg.version)
    : pendingChangesetLevel();
if (LEVEL[diff.required] > LEVEL[allowed]) {
  problems.push(
    `the public API changed vs the ${baseline.version} baseline in ways that need a ${diff.required} ` +
      `release, but the version bump/changesets only allow ${allowed} — add a changeset ` +
      `(pnpm changeset) or revert:`,
    ...diff.changes.map((c) => `  ${c}`),
  );
}

if (problems.length) fail(problems);

/* ------------------------------------------------------------------ emit */

const positions = sourcePositions();
const resolveSince = (v) => (v === 'next' ? pkg.version : v);

const api = {
  schema: 1,
  package: pkg.name,
  version: pkg.version,
  /* Every @example block is shape-gated above and executed with asserted
   * output by examples/api-doctest.test.ts in this repo's CI — consumers may
   * render them as verified. Additive field; schema stays 1. */
  examplesVerified: true,
  groups: groups.map((g) => ({ id: g.id, title: g.title, symbols: g.symbols })),
  symbols: symbols.map((s) => ({
    ...s,
    source: positions.get(s.id) ?? null,
    since: resolveSince(since[s.id]),
  })),
};

writeFileSync(join(PKG_DIR, 'dist', 'api.json'), JSON.stringify(api, null, 2) + '\n');

const withSource = api.symbols.filter((s) => s.source).length;
console.log(
  `[api] dist/api.json — ${api.symbols.length} symbols · ${groups.length} groups · ` +
    `${withSource}/${api.symbols.length} source-mapped · ` +
    `${doctest.examples.length} doctested @example block(s) · ` +
    `params documented ${coverage.paramsDocumented}/${coverage.paramsTotal} + @returns (gated)`,
);
if (diff.changes.length) {
  console.log(
    `[api] surface vs ${baseline.version} baseline: ${diff.changes.length} change(s), ${diff.required} required, ${allowed} allowed`,
  );
} else {
  console.log(`[api] surface identical to the ${baseline.version} baseline`);
}
