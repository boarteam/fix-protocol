/* The README type-check gate — the third doc gate, closing the hole the other two leave.
 *
 * `examples/api-doctest.test.ts` EXECUTES every TSDoc `@example`; `pnpm examples` and
 * `examples/examples.test.ts` execute every `examples/*.mjs`. Nothing compiled the ```ts
 * fences in the READMEs — the files a reader copies from first — so they could ship code
 * that does not compile, and in 0.6.0 they did: the new
 * "Inbound messages" / "Reading an inbound message" sections printed
 * `parse(raw, dictionary)`, passing the dict package's `dictionary` export straight in.
 * That export is a `DictionaryJSON` and `parse` takes `Dictionary | FixtDictionaries`, so
 * the snippet never compiled as printed. It was caught downstream by the boar.team site's
 * sample type-check, not here, and fixed in c0e5da5 by calling `loadDictionary` first.
 * This gate compiles those fences against the built workspace packages, so the next such
 * drift fails in this repo instead.
 *
 * Worth knowing when reviewing a snippet, because it is what makes that mistake easy: the
 * dictionary argument is NOT uniform across the surface.
 *   - Accept `Dictionary | DictionaryJSON`, so a dict package's raw export works as-is:
 *     `toInbound`, `inboundKnownGuard`, `createMessage`, `createImmutableMessage`,
 *     `messageFactory`, `createFixEngine`.
 *   - Require a loaded `Dictionary` (or a `FixtDictionaries` pair): `parse`, `parseAll`,
 *     `encode`, `validate` — call `loadDictionary` first.
 * A `FixtDictionaries` pair takes JSON on either side, so `parse(raw, { transport, app })`
 * accepts exactly what `parse(raw, dictionary)` refuses. A snippet can therefore mix both
 * conventions two lines apart and look perfectly consistent while only half of it compiles.
 *
 * COMPILE-ONLY, deliberately: these fences are excerpts, not programs. They reference
 * identifiers the surrounding prose established (`raw`, `fix`, a `message` from an earlier
 * fence), so a fence may carry a preamble, or opt out, via an HTML comment sitting
 * immediately above it — invisible on GitHub and npm, so the rendered README is unchanged:
 *
 *     <!-- doc-typecheck
 *     declare const raw: string;
 *     -->
 *     ```ts
 *     const { message, issues } = parse(raw, dictionary);
 *     ```
 *
 *     <!-- doc-typecheck: skip — why this fence cannot be compiled -->
 *
 * A `skip` must state a reason. Everything else is a hard failure: an undeclared identifier
 * in a fence is the very class of defect this gate exists to catch, so it is never silently
 * tolerated — a fence either compiles or says out loud why it is exempt.
 *
 * The compiler options below are a READER's, not this repo's. `strict`, but without
 * `noUncheckedIndexedAccess` (a library-internal choice, not part of `strict`, that would
 * flag the deliberate `message.fields[55].value` shorthand the READMEs use for readability)
 * and without the `noUnused*` pair (which would flag `const wire = fix.encode(...)`, where
 * producing the value IS the point). Snippets compile in memory against `dist/*.d.ts`
 * through this directory's node_modules workspace links — the same resolution a consumer
 * gets from npm — so the gate is skipped, like the doctest, until the packages are built.
 */
import ts from 'typescript';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const EXAMPLES_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_DIR = join(EXAMPLES_DIR, '..');

/**
 * Every README in the repo that carries TypeScript. Adding a file here brings its ```ts
 * fences under the gate — and, if it imports a package the runnable examples do not already
 * depend on, that package needs a `workspace:*` entry in `examples/package.json` so the
 * import resolves through this directory's node_modules.
 */
const README_FILES = [
  'README.md',
  'packages/fix/README.md',
  'packages/fix-dict-fix42/README.md',
  'packages/fix-dict-fix44/README.md',
  'packages/fix-dict-fix50sp2/README.md',
  'packages/fix-dict-fixt11/README.md',
];

/** Every fence is made a module, so two fences declaring `fix` do not collide. */
const MODULE_MARKER = 'export {};';

interface Snippet {
  /** `README.md:19` — the opening fence's line, clickable from a terminal. */
  id: string;
  file: string;
  /** 1-based line of the first line of code inside the fence. */
  codeLine: number;
  /** Nearest preceding heading, so a failing test names the section a reader would look at. */
  heading: string;
  code: string;
  /** TypeScript prepended before the fence, from a `<!-- doc-typecheck ... -->` comment. */
  preamble: string;
  /** Set when the fence opted out; the string is the required reason. */
  skip?: string;
}

/* ------------------------------------------------------------------------- extraction */

/**
 * The ```ts / ```typescript fences of one markdown file, each with the directive comment
 * that precedes it resolved. Returns `{ snippets, problems }`; the caller fails on problems
 * — a malformed directive must not degrade into "no preamble" and a confusing type error.
 */
function extractSnippets(file: string, markdown: string) {
  const lines = markdown.split('\n');
  const snippets: Snippet[] = [];
  const problems: string[] = [];
  let heading = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const head = /^#{1,6}\s+(.*?)\s*$/.exec(line);
    if (head) {
      heading = head[1]!.replace(/`/g, '');
      continue;
    }
    const open = /^```([A-Za-z0-9]*)/.exec(line);
    if (!open) continue;

    let close = i + 1;
    while (close < lines.length && !/^```\s*$/.test(lines[close]!)) close++;
    if (close >= lines.length) {
      problems.push(`${file}:${i + 1}: fenced block is never closed`);
      break;
    }
    const lang = open[1]!.toLowerCase();
    if (lang === 'ts' || lang === 'typescript') {
      const id = `${file}:${i + 1}`;
      const directive = readDirective(lines, i, id, problems);
      snippets.push({
        id,
        file,
        codeLine: i + 2,
        heading,
        code: lines.slice(i + 1, close).join('\n'),
        preamble: directive.preamble,
        ...(directive.skip === undefined ? {} : { skip: directive.skip }),
      });
    }
    i = close;
  }
  return { snippets, problems };
}

/**
 * The `<!-- doc-typecheck ... -->` comment immediately above the fence at `fenceIndex`, if
 * any. Only blank lines may sit between the comment and the fence; any other HTML comment
 * there (the READMEs carry a few editorial ones) is left alone.
 */
function readDirective(lines: string[], fenceIndex: number, id: string, problems: string[]) {
  let end = fenceIndex - 1;
  while (end >= 0 && lines[end]!.trim() === '') end--;
  if (end < 0 || !lines[end]!.trimEnd().endsWith('-->')) return { preamble: '' };

  let start = end;
  while (start >= 0 && !lines[start]!.includes('<!--')) start--;
  if (start < 0) return { preamble: '' };

  const body = lines.slice(start, end + 1).join('\n');
  const inner = /<!--([\s\S]*?)-->/.exec(body)?.[1];
  if (inner === undefined) return { preamble: '' };

  const rest = /^\s*doc-typecheck\b:?([\s\S]*)$/.exec(inner)?.[1];
  if (rest === undefined) return { preamble: '' }; // an ordinary editorial comment

  const skip = /^\s*skip\b[\s:—-]*([\s\S]*)$/.exec(rest);
  if (skip) {
    const reason = skip[1]!.trim();
    if (!reason) problems.push(`${id}: \`doc-typecheck: skip\` must give a reason`);
    return { preamble: '', skip: reason };
  }

  const preamble = rest.replace(/^[ \t]*\n/, '').trimEnd();
  if (!preamble.trim()) {
    problems.push(`${id}: empty \`doc-typecheck\` comment — give a preamble or say \`skip: …\``);
    return { preamble: '' };
  }
  return { preamble };
}

/* --------------------------------------------------------------------------- checking */

/**
 * Compile every snippet in one program and return its diagnostics, remapped to README
 * coordinates. The files are virtual but their paths sit in this directory, so `@boarteam/*`
 * resolves through `examples/node_modules` to the built packages exactly as it does for the
 * runnable examples next door.
 */
function typecheck(snippets: Snippet[]) {
  const sources = new Map<string, string>();
  const owner = new Map<string, Snippet>();
  for (const s of snippets) {
    const path = join(
      EXAMPLES_DIR,
      `${s.file.replace(/[^A-Za-z0-9]+/g, '-')}-${s.codeLine}.snippet.ts`,
    );
    const preambleLines = s.preamble ? s.preamble.split('\n') : [];
    sources.set(path, [...preambleLines, s.code, MODULE_MARKER].join('\n'));
    owner.set(path, s);
  }

  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
    strict: true,
    isolatedModules: true,
    esModuleInterop: true,
    skipLibCheck: true,
    noEmit: true,
    // A reader's tsconfig, not this repo's — see the header.
    noUncheckedIndexedAccess: false,
    noUnusedLocals: false,
    noUnusedParameters: false,
    // Ambient @types/* differ between a dev machine and CI; the snippets must not depend on
    // any. `console` comes from lib.dom, which a browser-capable library has anyway.
    types: [],
  };

  const host = ts.createCompilerHost(options, true);
  const readFile = host.readFile.bind(host);
  const getSourceFile = host.getSourceFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  host.readFile = (name) => sources.get(name) ?? readFile(name);
  host.fileExists = (name) => sources.has(name) || fileExists(name);
  host.getSourceFile = (name, languageVersion, ...rest) => {
    const virtual = sources.get(name);
    return virtual === undefined
      ? getSourceFile(name, languageVersion, ...rest)
      : ts.createSourceFile(name, virtual, languageVersion, true);
  };

  const program = ts.createProgram([...sources.keys()], options, host);
  const failures = new Map<string, string[]>(snippets.map((s) => [s.id, []]));
  for (const d of [...program.getSyntacticDiagnostics(), ...program.getSemanticDiagnostics()]) {
    const snippet = d.file ? owner.get(d.file.fileName) : undefined;
    if (!snippet || d.start === undefined) continue;
    const { line, character } = d.file!.getLineAndCharacterOfPosition(d.start);
    const preambleLines = snippet.preamble ? snippet.preamble.split('\n').length : 0;
    const where =
      line < preambleLines
        ? `${snippet.id} (doc-typecheck preamble line ${line + 1})`
        : `${snippet.file}:${snippet.codeLine + line - preambleLines}:${character + 1}`;
    const text = ts.flattenDiagnosticMessageText(d.messageText, ' ');
    failures.get(snippet.id)!.push(`${where} — TS${d.code}: ${text}`);
  }
  return failures;
}

/* ------------------------------------------------------------------------------- gate */

const built = existsSync(join(REPO_DIR, 'packages', 'fix', 'dist', 'index.d.ts'));

const extracted = README_FILES.flatMap((file) =>
  built ? [extractSnippets(file, readFileSync(join(REPO_DIR, file), 'utf8'))] : [],
);
const snippets = extracted.flatMap((e) => e.snippets);
const problems = extracted.flatMap((e) => e.problems);
const compiled = snippets.filter((s) => s.skip === undefined);
const failures = built ? typecheck(compiled) : new Map<string, string[]>();

describe.skipIf(!built)('README ```ts fences type-check', () => {
  it('every fence is well formed and every skip states a reason', () => {
    expect(problems).toEqual([]);
    // A floor, not a count: extraction silently finding nothing — a fence-syntax change, a
    // renamed README — would otherwise pass every other test in this file.
    expect(compiled.length).toBeGreaterThanOrEqual(10);
  });

  for (const snippet of snippets) {
    const name = `${snippet.id} — ${snippet.heading}`;
    // Exemptions stay visible: a skipped fence is reported by name, with its reason, rather
    // than vanishing from the run.
    if (snippet.skip !== undefined) {
      it.skip(`${name} (doc-typecheck skip: ${snippet.skip})`, () => {});
      continue;
    }
    it(name, () => {
      expect(failures.get(snippet.id) ?? []).toEqual([]);
    });
  }
});
