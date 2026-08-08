/* The @example doctest — phase 3 of the generated-API-reference plan, and the
 * library-side twin of boar.team's tools/fix-docs/verify-samples.mjs.
 *
 * Every `@example` block in the public doc comments is EXECUTED here, verbatim,
 * against the built workspace packages (this directory's node_modules carries
 * the workspace links, so snippets import '@boarteam/fix' exactly like a
 * consumer). The `// → ` annotations in a block are asserted outputs: the
 * snippet's stdout must equal them line for line. A block that does not run,
 * asserts nothing, or prints something else fails the suite — which is what
 * lets dist/api.json claim `examplesVerified` and the site render examples.
 *
 * Authoring rules (see docs/api-json.md):
 *   - an @example section is exactly one fenced code block;
 *   - the code is runnable ESM JavaScript (node runs it un-transpiled);
 *   - at least one `// → ` annotation per block — an example that asserts
 *     nothing proves nothing;
 *   - deterministic output only (no clocks, no randomness).
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Plain .mjs build tooling — no d.ts; the assertions below are the typing.
// @ts-expect-error untyped internal script module
import * as apiModel from '../packages/fix/scripts/api-model.mjs';

const { extractSurface, extractExamples, exampleAnnotations } = apiModel as {
  extractSurface: () => { symbols: unknown[]; problems: string[] };
  extractExamples: (symbols: unknown[]) => {
    examples: { id: string; caption: string; lang: string; code: string }[];
    problems: string[];
  };
  exampleAnnotations: (code: string) => string[];
};

const EXAMPLES_DIR = dirname(fileURLToPath(import.meta.url));
const built = existsSync(join(EXAMPLES_DIR, '..', 'packages', 'fix', 'dist', 'index.d.ts'));

const { examples, problems } = built
  ? (() => {
      const surface = extractSurface();
      const extracted = extractExamples(surface.symbols);
      return {
        examples: extracted.examples,
        problems: [...surface.problems, ...extracted.problems],
      };
    })()
  : { examples: [], problems: [] };

describe.skipIf(!built)('@example doctest', () => {
  it('every @example is a single well-formed fence', () => {
    expect(problems).toEqual([]);
    expect(examples.length).toBeGreaterThanOrEqual(2);
  });

  for (const example of examples) {
    it(`${example.id}${example.caption ? ` — ${example.caption}` : ''}`, () => {
      const expected = exampleAnnotations(example.code);
      expect(expected.length, 'an example must annotate at least one output').toBeGreaterThan(0);

      const res = spawnSync(process.execPath, ['--input-type=module', '--eval', example.code], {
        cwd: EXAMPLES_DIR,
        encoding: 'utf8',
        timeout: 30_000,
      });
      expect(res.status, `stderr:\n${res.stderr}`).toBe(0);

      const got = res.stdout
        .replace(/\n+$/, '')
        .split('\n')
        .map((l) => l.trimEnd());
      expect(got).toEqual(expected.flatMap((a) => a.split('\n')));
    });
  }
});
