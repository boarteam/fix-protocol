/* The API model behind dist/api.json — extraction, link integrity, and the
 * structural diff. Pure functions over the TypeScript compiler API; emit-api.mjs
 * wires them into the build and applies the gates.
 *
 * Fidelity rules (shared with the boar.team site, which cross-checks this
 * model against the same dist/index.d.ts it reads itself):
 *  - The EXPORT name is the identity — a rollup renames declarations on
 *    collision; the export name is what users type.
 *  - Signatures and member types are the verbatim `.d.ts` text (minus
 *    `declare `), never re-printed by the checker: what ships is what renders.
 *  - Doc text ships RAW (the last JSDoc block, `*`-stripped). Consumers parse
 *    it; this package only guarantees the {@link} graph resolves.
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_DIR = join(PKG_DIR, '..', '..');

/** `{@link}` targets that are JavaScript globals, not exports — allowed as-is. */
const GLOBAL_LINK_TARGETS = new Set(['String.indexOf']);

/* ------------------------------------------------------------- extraction */

/**
 * Read the public surface from a rolled-up `.d.ts`. Returns `{ symbols,
 * problems }`; the caller decides that problems fail the build (they do).
 */
export function extractSurface(dtsPath = join(PKG_DIR, 'dist', 'index.d.ts')) {
  const program = ts.createProgram([dtsPath], { strict: true, skipLibCheck: true, noEmit: true });
  const checker = program.getTypeChecker();
  const sf = program.getSourceFile(dtsPath);
  if (!sf) throw new Error(`[api] cannot read ${dtsPath} — build first (tsup)`);

  const problems = [];
  const moduleSymbol = checker.getSymbolAtLocation(sf) ?? sf.symbol;
  const symbols = [];
  for (const exported of checker.getExportsOfModule(moduleSymbol)) {
    const name = exported.getName();
    const symbol =
      exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
    const decl = symbol.declarations?.[0];
    if (!decl) {
      problems.push(`export ${name} has no declaration`);
      continue;
    }
    symbols.push(readSymbol(name, decl, sf, problems));
  }
  symbols.sort((a, b) => (a.id < b.id ? -1 : 1));
  return { symbols, problems };
}

function readSymbol(name, decl, sf, problems) {
  const kind = kindOf(decl);
  const docNode =
    kind === 'const' && decl.parent?.parent && ts.isVariableStatement(decl.parent.parent)
      ? decl.parent.parent
      : decl;
  const base = { id: name, kind, doc: lastJsDocText(docNode, sf, problems, name) };

  switch (kind) {
    case 'function':
      return {
        ...base,
        signature: stripDeclare(nodeText(decl, sf)),
        params: (decl.parameters ?? []).map((p) => ({
          name: p.name.getText(sf),
          type: p.type ? p.type.getText(sf) : '',
          optional: Boolean(p.questionToken),
        })),
        returns: decl.type ? decl.type.getText(sf) : '',
      };
    case 'interface':
    case 'class': {
      const typeParams = decl.typeParameters?.length
        ? `<${decl.typeParameters.map((t) => t.getText(sf)).join(', ')}>`
        : '';
      return {
        ...base,
        signature: `${kind} ${name}${typeParams}`,
        members: readMembers(name, decl, sf, problems),
      };
    }
    case 'type':
      return {
        ...base,
        signature: stripDeclare(nodeText(decl, sf)),
        unionOf: literalUnion(decl),
      };
    case 'const': {
      const statement =
        decl.parent?.parent && ts.isVariableStatement(decl.parent.parent)
          ? decl.parent.parent
          : decl;
      return { ...base, signature: stripDeclare(nodeText(statement, sf)) };
    }
    default:
      problems.push(`${name}: unhandled declaration kind ${ts.SyntaxKind[decl.kind]}`);
      return base;
  }
}

function readMembers(symbolName, decl, sf, problems) {
  const members = [];
  for (const member of decl.members ?? []) {
    if (member.name && ts.isPrivateIdentifier(member.name)) continue;
    let name;
    let kind;
    if (ts.isConstructorDeclaration(member)) {
      name = 'constructor';
      kind = 'constructor';
    } else if (ts.isCallSignatureDeclaration(member)) {
      name = '';
      kind = 'call';
    } else if (ts.isIndexSignatureDeclaration(member)) {
      const param = member.parameters[0];
      name = `[${param.name.getText(sf)}: ${param.type?.getText(sf) ?? '?'}]`;
      kind = 'index';
    } else if (ts.isGetAccessorDeclaration(member)) {
      name = member.name.getText(sf);
      kind = 'get';
    } else if (ts.isMethodSignature(member) || ts.isMethodDeclaration(member)) {
      name = member.name.getText(sf);
      kind = 'method';
    } else if (ts.isPropertySignature(member) || ts.isPropertyDeclaration(member)) {
      name = member.name.getText(sf);
      kind = 'property';
    } else {
      problems.push(`${symbolName}: unhandled member kind ${ts.SyntaxKind[member.kind]}`);
      continue;
    }
    members.push({
      name,
      kind,
      optional: Boolean(member.questionToken),
      text: dedent(nodeText(member, sf)),
      doc: lastJsDocText(member, sf, problems, `${symbolName}.${name || kind}`),
    });
  }
  return members;
}

function literalUnion(decl) {
  const type = decl.type;
  if (!type || !ts.isUnionTypeNode(type)) return undefined;
  const values = [];
  for (const t of type.types) {
    if (ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal)) values.push(t.literal.text);
    else return undefined;
  }
  return values;
}

function kindOf(decl) {
  if (ts.isFunctionDeclaration(decl)) return 'function';
  if (ts.isClassDeclaration(decl)) return 'class';
  if (ts.isInterfaceDeclaration(decl)) return 'interface';
  if (ts.isTypeAliasDeclaration(decl)) return 'type';
  if (ts.isVariableDeclaration(decl)) return 'const';
  return ts.SyntaxKind[decl.kind];
}

const nodeText = (node, sf) => sf.text.slice(node.getStart(sf), node.getEnd()).replace(/;$/, '');
const stripDeclare = (text) => text.replace(/^declare\s+/, '');

function dedent(text) {
  const lines = text.split('\n');
  if (lines.length === 1) return text;
  const indents = lines
    .slice(1)
    .filter((l) => l.trim())
    .map((l) => /^\s*/.exec(l)[0].length);
  const cut = indents.length ? Math.min(...indents) : 0;
  return [lines[0], ...lines.slice(1).map((l) => l.slice(cut))].join('\n');
}

/** The raw text of the LAST JSDoc block — the one the checker treats as the doc. */
function lastJsDocText(node, sf, problems, where) {
  const blocks = node.jsDoc;
  if (!blocks?.length) return '';
  const raw = sf.text.slice(blocks[blocks.length - 1].pos, blocks[blocks.length - 1].end);
  const text = raw
    .replace(/^\/\*\*/, '')
    .replace(/\*\/\s*$/, '')
    .split('\n')
    .map((l) => l.replace(/^\s*\* ?/, '').replace(/\s+$/, ''))
    .join('\n')
    .replace(/^\n+|\n+$/g, '');
  for (const tag of text.matchAll(/^@([A-Za-z]+)(?:\s|$)/gm)) {
    if (!['param', 'returns', 'example'].includes(tag[1])) {
      problems.push(
        `${where}: unsupported JSDoc tag @${tag[1]} — the api.json consumers only know @param/@returns/@example`,
      );
    }
  }
  return text;
}

/* ------------------------------------------------------- source positions */

/**
 * Map export names to `{ path, line }` in the ORIGINAL source, by running the
 * compiler over `src/index.ts` — the rollup has no usable positions.
 */
export function sourcePositions(entry = join(PKG_DIR, 'src', 'index.ts')) {
  const program = ts.createProgram([entry], { strict: true, skipLibCheck: true, noEmit: true });
  const checker = program.getTypeChecker();
  const sf = program.getSourceFile(entry);
  if (!sf) throw new Error(`[api] cannot read ${entry}`);
  const moduleSymbol = checker.getSymbolAtLocation(sf) ?? sf.symbol;
  const positions = new Map();
  for (const exported of checker.getExportsOfModule(moduleSymbol)) {
    const name = exported.getName();
    const symbol =
      exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
    const decl = symbol.declarations?.[0];
    if (!decl) continue;
    const file = decl.getSourceFile();
    const { line } = file.getLineAndCharacterOfPosition(decl.getStart(file));
    positions.set(name, { path: relative(REPO_DIR, file.fileName), line: line + 1 });
  }
  return positions;
}

/* -------------------------------------------------------- link integrity */

/**
 * Every `{@link target}` in every doc comment must resolve: an export, an
 * `Export.member`, a member/param of the ENCLOSING declaration, or an
 * allowlisted JS global. Rollup path forms (`./x`, `../x`) are always errors —
 * fix the comment, don't teach consumers to salvage it.
 */
export function checkLinks(symbols) {
  const problems = [];
  const byId = new Map(symbols.map((s) => [s.id, s]));
  const resolvesAs = (target, enclosing) => {
    if (GLOBAL_LINK_TARGETS.has(target)) return true;
    if (target.includes('/')) return false;
    const segs = target.split('.');
    if (segs.length === 1) {
      if (byId.has(target)) return true;
      if (!enclosing) return false;
      return (
        (enclosing.members ?? []).some((m) => m.name === target) ||
        (enclosing.params ?? []).some((p) => p.name === target)
      );
    }
    if (segs.length === 2) {
      const sym = byId.get(segs[0]);
      return Boolean(sym && (sym.members ?? []).some((m) => m.name === segs[1]));
    }
    return false;
  };
  const scan = (text, enclosing, where) => {
    for (const m of text.matchAll(/\{@link\s+([^}|\s]+)[^}]*\}/g)) {
      if (!resolvesAs(m[1], enclosing)) {
        problems.push(`${where}: unresolvable {@link ${m[1]}}`);
      }
    }
  };
  for (const s of symbols) {
    scan(s.doc, s, s.id);
    for (const mem of s.members ?? []) scan(mem.doc, s, `${s.id}.${mem.name || mem.kind}`);
  }
  return problems;
}

/* --------------------------------------------------------- doc coverage */

/** Undocumented exports and members fail; params/returns are reported only. */
export function checkDocCoverage(symbols) {
  const problems = [];
  let paramsDocumented = 0;
  let paramsTotal = 0;
  for (const s of symbols) {
    if (!s.doc) problems.push(`${s.id}: exported symbol has no doc comment`);
    for (const m of s.members ?? []) {
      if (!m.doc) problems.push(`${s.id}.${m.name || m.kind}: member has no doc comment`);
    }
    for (const p of s.params ?? []) {
      paramsTotal++;
      if (new RegExp(`^@param\\s+${p.name}\\b`, 'm').test(s.doc)) paramsDocumented++;
    }
  }
  return { problems, paramsDocumented, paramsTotal };
}

/* -------------------------------------------------------------- API diff */

const LEVEL = { none: 0, patch: 1, minor: 2, major: 3 };

/** The change level two versions imply (literal SemVer positions, 0.x included). */
export function versionDelta(from, to) {
  const [fM, fm, fp] = from.split('.').map(Number);
  const [tM, tm, tp] = to.split('.').map(Number);
  if (tM !== fM) return 'major';
  if (tm !== fm) return 'minor';
  if (tp !== fp) return 'patch';
  return 'none';
}

/** The structural view the diff compares — everything except docs/since/source. */
export function structuralOf(symbols) {
  return symbols.map((s) => ({
    id: s.id,
    kind: s.kind,
    signature: s.signature ?? '',
    params: (s.params ?? []).map((p) => ({ name: p.name, type: p.type, optional: p.optional })),
    returns: s.returns ?? '',
    members: (s.members ?? []).map((m) => ({
      name: m.name,
      kind: m.kind,
      optional: m.optional,
      text: m.text,
    })),
    unionOf: s.unionOf ?? null,
  }));
}

/**
 * Diff the current structural surface against the last released baseline and
 * return `{ changes, required }`: what changed, and the minimum release level
 * those changes demand (additions → minor; removals/alterations → major).
 */
export function diffAgainstBaseline(current, baseline) {
  const changes = [];
  let required = 'none';
  const raise = (level) => {
    if (LEVEL[level] > LEVEL[required]) required = level;
  };
  const cur = new Map(structuralOf(current).map((s) => [s.id, s]));
  const base = new Map(baseline.symbols.map((s) => [s.id, s]));

  for (const [id, b] of base) {
    const c = cur.get(id);
    if (!c) {
      changes.push(`removed export ${id}`);
      raise('major');
      continue;
    }
    if (JSON.stringify(c) !== JSON.stringify(b)) {
      const memberNames = (list) => new Set(list.members.map((m) => m.name || m.kind));
      const bNames = memberNames(b);
      const cNames = memberNames(c);
      const removedMembers = [...bNames].filter((n) => !cNames.has(n));
      const addedMembers = [...cNames].filter((n) => !bNames.has(n));
      const sameShape =
        removedMembers.length === 0 &&
        c.kind === b.kind &&
        c.signature === b.signature &&
        c.returns === b.returns &&
        JSON.stringify(c.params) === JSON.stringify(b.params) &&
        JSON.stringify(c.unionOf) === JSON.stringify(b.unionOf) &&
        JSON.stringify(c.members.filter((m) => bNames.has(m.name || m.kind))) ===
          JSON.stringify(b.members);
      if (sameShape && addedMembers.length > 0) {
        changes.push(`extended ${id} (+${addedMembers.join(', +')})`);
        raise('minor');
      } else {
        changes.push(`changed ${id}`);
        raise('major');
      }
    }
  }
  for (const id of cur.keys()) {
    if (!base.has(id)) {
      changes.push(`added export ${id}`);
      raise('minor');
    }
  }
  return { changes, required };
}

/** The strongest bump pending changesets declare for @boarteam/fix. */
export function pendingChangesetLevel(changesetDir = join(REPO_DIR, '.changeset')) {
  let level = 'none';
  let files;
  try {
    files = require('node:fs')
      .readdirSync(changesetDir)
      .filter((f) => f.endsWith('.md') && f !== 'README.md');
  } catch {
    return level;
  }
  for (const f of files) {
    const text = readFileSync(join(changesetDir, f), 'utf8');
    const m = /^['"]?@boarteam\/fix['"]?\s*:\s*(major|minor|patch)\s*$/m.exec(text);
    if (m && LEVEL[m[1]] > LEVEL[level]) level = m[1];
  }
  return level;
}

export { LEVEL };

/* --------------------------------------------------------------- examples */

/**
 * Every `@example` block in the surface as a runnable unit: the caption from
 * the tag line plus the body of the SINGLE fenced code block the section must
 * consist of. Anything else in the section — stray prose, a second fence, no
 * fence at all — is a shape problem, and both the emit and the doctest refuse
 * it: an example that cannot be executed verbatim documents nothing.
 */
export function extractExamples(symbols) {
  const examples = [];
  const problems = [];
  const scan = (doc, where) => {
    const lines = doc.split('\n');
    let section = null;
    const sections = [];
    for (const line of lines) {
      const tag = /^@([A-Za-z]+)[ \t]*(.*)$/.exec(line);
      if (tag) {
        section = tag[1] === 'example' ? { caption: tag[2].trim(), lines: [] } : null;
        if (section) sections.push(section);
        continue;
      }
      section?.lines.push(line);
    }
    sections.forEach((s, i) => {
      const body = s.lines.join('\n').trim();
      const fence = /^```([A-Za-z]*)\n([\s\S]*?)\n```$/.exec(body);
      const id = `${where} @example ${i + 1}`;
      if (!fence) {
        problems.push(`${id}: must consist of exactly one fenced code block`);
        return;
      }
      examples.push({ id, where, caption: s.caption, lang: fence[1] || 'ts', code: fence[2] });
    });
  };
  for (const s of symbols) {
    scan(s.doc, s.id);
    for (const m of s.members ?? []) scan(m.doc, `${s.id}.${m.name || m.kind}`);
  }
  return { examples, problems };
}

/**
 * The `// → ` output annotations of an example, in order. Only the line form
 * exists here — a `/* → *\/` block would close the enclosing JSDoc comment.
 * The doctest asserts the example's stdout equals these lines exactly.
 */
export function exampleAnnotations(code) {
  const out = [];
  for (const m of code.matchAll(/\/\/ → (.*)$/gm)) out.push(m[1].trimEnd());
  return out;
}
