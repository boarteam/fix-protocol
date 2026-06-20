import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  ComponentDef,
  CoverageGap,
  DataTypeDef,
  DictionaryJSON,
  FieldDef,
  MessageCategory,
  MessageDef,
} from '@boarteam/fix';
import { parseDatatypes } from './datatypes';
import { parseField } from './fields';
import { bodyLines, heading } from './markdown';
import { parseMemberTable, type TableRow } from './table';
import { buildMembers, type BuildContext, harvestRegistry } from './structure';

/** FIX 4.4 session-level (administrative) message types. Everything else is application. */
const ADMIN_MSG_TYPES = new Set(['0', '1', '2', '3', '4', '5', 'A']);

const COMPONENT_NAME = /<([^>]+)>/;
const MESSAGE_H1 = /^(.+?)\s*\(MsgType\s*=\s*(.+?)\)\s*$/;

interface RawComponent {
  name: string;
  file: string;
  rows: TableRow[];
}
interface RawMessage {
  name: string;
  msgType: string;
  rows: TableRow[];
}

export interface GenerateResult {
  dictionary: DictionaryJSON;
  gaps: CoverageGap[];
}

/**
 * Generate the full FIX 4.4 dictionary JSON from the Markdown reference tree at
 * {@link specDir} (the directory containing `fields/`, `components/`, `messages/`, and
 * `data-types.md`). Pure with respect to the filesystem input — same tree in, same
 * dictionary out — so regeneration is idempotent.
 */
export function generate(specDir: string): GenerateResult {
  const gaps: CoverageGap[] = [];

  const datatypes = parseDatatypes(read(join(specDir, 'data-types.md')));

  // Fields.
  const fields: Record<number, FieldDef> = {};
  for (const file of mdFiles(join(specDir, 'fields'), /^tag_\d+_.*\.md$/)) {
    const field = parseField(read(join(specDir, 'fields', file)));
    if (field) {
      fields[field.tag] = field;
    }
  }
  const isCounter = (tag: number): boolean => fields[tag]?.isGroupCounter === true;

  // Components and messages: parse raw tables first (needed for the canonical registry).
  const componentNameByFile = new Map<string, string>();
  const rawComponents: RawComponent[] = [];
  for (const file of mdFiles(join(specDir, 'components'), /\.md$/)) {
    const content = read(join(specDir, 'components', file));
    const lines = bodyLines(content);
    const nameMatch = heading(lines).match(COMPONENT_NAME);
    if (!nameMatch) {
      continue;
    }
    const base = file.replace(/\.md$/i, '');
    const name = nameMatch[1]!.trim();
    componentNameByFile.set(base, name);
    rawComponents.push({ name, file: base, rows: parseMemberTable(lines) });
  }
  const knownComponents = new Set(rawComponents.map((c) => c.name));

  const rawMessages: RawMessage[] = [];
  for (const file of mdFiles(join(specDir, 'messages'), /\.md$/)) {
    const content = read(join(specDir, 'messages', file));
    const lines = bodyLines(content);
    const h1 = heading(lines).match(MESSAGE_H1);
    if (!h1) {
      continue;
    }
    rawMessages.push({
      name: h1[1]!.trim(),
      msgType: h1[2]!.trim(),
      rows: parseMemberTable(lines),
    });
  }

  const allRows = [...rawComponents.map((c) => c.rows), ...rawMessages.map((m) => m.rows)];
  const { registry, ambiguous } = harvestRegistry(allRows, isCounter);

  // Link each length-prefixed `data` field to the `Length` field that precedes it on the
  // wire (the relationship is positional in the spec's member tables).
  linkLengthFields(fields, datatypes, allRows);

  const ctx = (where: string): BuildContext => ({
    isCounter,
    componentNameByFile,
    knownComponents,
    registry,
    ambiguousCounters: ambiguous,
    where,
    gaps,
  });

  const components: Record<string, ComponentDef> = {};
  for (const c of rawComponents) {
    components[c.name] = {
      name: c.name,
      members: buildMembers(c.rows, ctx(`component ${c.name}`)),
    };
  }

  const messages: MessageDef[] = rawMessages.map((m) => ({
    name: m.name,
    msgType: m.msgType,
    category: categoryOf(m.msgType),
    members: buildMembers(m.rows, ctx(`message ${m.name} (${m.msgType})`)),
  }));

  const dictionary: DictionaryJSON = {
    version: 'FIX.4.4',
    beginString: 'FIX.4.4',
    source: {
      generator: '@boarteam/fix-codegen',
      spec: 'FIX 4.4 Markdown reference (B2BITS FIXopaedia)',
      generatedFrom: 'markdown',
    },
    datatypes,
    fields,
    components,
    messages,
    ...(gaps.length > 0 ? { coverageGaps: gaps } : {}),
  };

  return { dictionary, gaps };
}

function categoryOf(msgType: string): MessageCategory {
  return ADMIN_MSG_TYPES.has(msgType) ? 'admin' : 'app';
}

/**
 * Set `lengthField` on every length-prefixed `data` field to the tag of the numeric
 * `Length` field that immediately precedes it at the same depth in some member table.
 * The pairing is fixed per field (e.g. `RawData` 96 → 95), so any one occurrence suffices.
 */
function linkLengthFields(
  fields: Record<number, FieldDef>,
  datatypes: Record<string, DataTypeDef>,
  rowLists: TableRow[][],
): void {
  const baseOf = (tag: number): string | undefined => {
    const field = fields[tag];
    return field ? datatypes[field.type]?.base : undefined;
  };
  for (const rows of rowLists) {
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1]!;
      const cur = rows[i]!;
      if (!prev.field || !cur.field || prev.depth !== cur.depth) {
        continue;
      }
      if (baseOf(cur.field.tag) === 'data' && baseOf(prev.field.tag) === 'int') {
        const def = fields[cur.field.tag];
        if (def && def.lengthField === undefined) {
          def.lengthField = prev.field.tag;
        }
      }
    }
  }
}

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

function mdFiles(dir: string, pattern: RegExp): string[] {
  return readdirSync(dir)
    .filter((f) => pattern.test(f) && f.toLowerCase() !== 'readme.md')
    .sort();
}
