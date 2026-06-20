import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { emitDictionaryJson, emitIndexTs } from './emit';
import { generate } from './generate';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const value = i !== -1 ? process.argv[i + 1] : undefined;
  return value ?? fallback;
}

function main(): void {
  const specDir = resolve(arg('spec', '/Users/jifeon/projects/fix'));
  const outDir = resolve(arg('out', resolve(process.cwd(), 'packages/fix-dict-fix44/src')));

  const { dictionary, gaps } = generate(specDir);

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'dictionary.json'), emitDictionaryJson(dictionary), 'utf8');
  writeFileSync(join(outDir, 'index.ts'), emitIndexTs(dictionary), 'utf8');

  const groupCount = countGroups(dictionary);
  process.stdout.write(
    `@boarteam/fix-codegen → ${outDir}\n` +
      `  datatypes:  ${Object.keys(dictionary.datatypes).length}\n` +
      `  fields:     ${Object.keys(dictionary.fields).length}\n` +
      `  components: ${Object.keys(dictionary.components).length}\n` +
      `  messages:   ${dictionary.messages.length}\n` +
      `  groups:     ${groupCount}\n` +
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

main();
