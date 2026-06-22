import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { DictionaryJSON } from '@boarteam/fix';
import {
  type Baseline,
  baselineSignatures,
  buildBaseline,
  crossCheck,
  renderReport,
} from './crosscheck';
import { emitDictionaryJson, emitIndexTs } from './emit';
import { generate } from './generate';
import { parseQuickFix } from './quickfix';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const value = i !== -1 ? process.argv[i + 1] : undefined;
  return value ?? fallback;
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

/** Default locations, relative to the repo root (the codegen runs from there). */
const DEFAULT_QUICKFIX_XML = 'packages/fix-codegen/vendor/quickfix/FIX44.xml';
const DEFAULT_DICT = 'packages/fix-dict-fix44/src/dictionary.json';
const DEFAULT_BASELINE = 'packages/fix-codegen/crosscheck-baseline.json';

function generateCommand(): void {
  const specDir = resolve(arg('spec', '/Users/dev/projects/fix'));
  const outDir = resolve(arg('out', resolve(process.cwd(), 'packages/fix-dict-fix44/src')));

  const { dictionary, gaps } = generate(specDir);

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'dictionary.json'), emitDictionaryJson(dictionary), 'utf8');
  writeFileSync(join(outDir, 'index.ts'), emitIndexTs(dictionary), 'utf8');

  process.stdout.write(
    `@boarteam/fix-codegen → ${outDir}\n` +
      `  datatypes:  ${Object.keys(dictionary.datatypes).length}\n` +
      `  fields:     ${Object.keys(dictionary.fields).length}\n` +
      `  components: ${Object.keys(dictionary.components).length}\n` +
      `  messages:   ${dictionary.messages.length}\n` +
      `  groups:     ${countGroups(dictionary)}\n` +
      `  gaps:       ${gaps.length}\n`,
  );
  if (gaps.length > 0) {
    const byKind = new Map<string, number>();
    for (const g of gaps) {
      byKind.set(g.kind, (byKind.get(g.kind) ?? 0) + 1);
    }
    for (const [kind, n] of byKind) {
      process.stdout.write(`    - ${kind}: ${n}\n`);
    }
  }
}

function loadDict(path: string): DictionaryJSON {
  return JSON.parse(readFileSync(path, 'utf8')) as DictionaryJSON;
}

/**
 * Cross-check the *shipped* dictionary (committed `dictionary.json`) against the vendored
 * QuickFIX `FIX44.xml`. With `--write-baseline`, (re)writes the accepted-difference allowlist.
 * Otherwise checks against the committed baseline and exits non-zero on any unexpected drift or
 * stale baseline entry — the same gate `crosscheck.test.ts` enforces in CI.
 */
function crosscheckCommand(): void {
  const dictPath = resolve(arg('dict', DEFAULT_DICT));
  const xmlPath = resolve(arg('quickfix', DEFAULT_QUICKFIX_XML));
  const baselinePath = resolve(arg('baseline', DEFAULT_BASELINE));
  const md = loadDict(dictPath);
  const xml = parseQuickFix(readFileSync(xmlPath, 'utf8'));

  if (flag('write-baseline')) {
    const baseline = buildBaseline(md, xml);
    writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
    process.stdout.write(
      `@boarteam/fix-codegen crosscheck --write-baseline\n` +
        `  baseline → ${baselinePath} (${baseline.entries.length} accepted differences)\n`,
    );
    return;
  }

  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as Baseline;
  const result = crossCheck(md, xml, baselineSignatures(baseline));

  process.stdout.write(
    `@boarteam/fix-codegen crosscheck (${dictPath} vs ${xmlPath})\n` +
      `  differences: ${result.differences.length}\n` +
      `  unexpected:  ${result.unexpected.length}\n` +
      `  resolved:    ${result.resolved.length}\n`,
  );
  for (const id of Object.keys(result.byCluster).sort()) {
    process.stdout.write(`    - ${id}: ${result.byCluster[id]}\n`);
  }

  const reportPath = arg('report', '');
  if (reportPath) {
    const out = resolve(reportPath);
    writeFileSync(out, renderReport(result), 'utf8');
    process.stdout.write(`  report → ${out}\n`);
  }

  if (result.unexpected.length > 0) {
    process.stderr.write('\nUNEXPECTED DIFFERENCES (drift):\n');
    for (const d of result.unexpected.slice(0, 50)) {
      process.stderr.write(`  [${d.cluster}] ${d.category} ${d.key}: ${d.detail}\n`);
    }
    process.exitCode = 1;
  }
  if (result.resolved.length > 0) {
    process.stderr.write(
      `\nRESOLVED baseline entries (no longer occur — rerun --write-baseline):\n  ${result.resolved
        .slice(0, 50)
        .join('\n  ')}\n`,
    );
    process.exitCode = 1;
  }
}

function countGroups(dict: ReturnType<typeof generate>['dictionary']): number {
  let n = 0;
  const walk = (members: (typeof dict.messages)[number]['members']): void => {
    for (const m of members) {
      if (m.kind === 'group') {
        n++;
        walk(m.members);
      }
    }
  };
  for (const c of Object.values(dict.components)) {
    walk(c.members);
  }
  for (const m of dict.messages) {
    walk(m.members);
  }
  return n;
}

function main(): void {
  const command = process.argv[2];
  if (command === 'crosscheck') {
    crosscheckCommand();
  } else {
    // Default (no command, or `generate`) emits the dictionary data files.
    generateCommand();
  }
}

main();
