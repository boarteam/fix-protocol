import type { EnumValue, FieldDef } from '@boarteam/fix';
import {
  bodyLines,
  heading,
  htmlUnescape,
  isTableDivider,
  isTableRow,
  tableCells,
} from './markdown';

// `**Tag:** N · **Type:** T` — the separator is a UTF-8 middle dot (U+00B7).
const TAG_TYPE = /\*\*Tag:\*\*\s*(\d+)\s*[·.]\s*\*\*Type:\*\*\s*(.+?)\s*$/;
const H1_TAG = /^(.+?)\s*\(Tag\s+(\d+)\)\s*$/;
// Every enum value cell is wrapped as `` `'value'` `` (backtick + single-quote + … ).
const ENUM_WRAP = /^`'(.*)'`$/;

/**
 * Parse a `fields/tag_<N>_<Name>.md` file into a {@link FieldDef}. Reads the field name
 * and tag from the H1, the datatype from the `**Tag:** N · **Type:** T` line, the prose
 * description, and — when present — the `## Valid values` enum table. Returns `undefined`
 * if the file lacks a recognisable tag/type line.
 */
export function parseField(content: string): FieldDef | undefined {
  const lines = bodyLines(content);

  let tag: number | undefined;
  let type: string | undefined;
  let tagLineIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = htmlUnescape(lines[i]!).match(TAG_TYPE);
    if (m) {
      tag = Number(m[1]);
      type = m[2]!.trim();
      tagLineIdx = i;
      break;
    }
  }
  if (tag === undefined || type === undefined) {
    return undefined;
  }

  const h1 = heading(lines).match(H1_TAG);
  const name = h1 ? h1[1]!.trim() : String(tag);

  const description = extractDescription(lines, tagLineIdx);
  const enumValues = extractEnumValues(lines);

  const field: FieldDef = { tag, name, type };
  if (description) {
    field.description = description;
  }
  if (enumValues.length > 0) {
    field.enumValues = enumValues;
  }
  if (type === 'NumInGroup') {
    field.isGroupCounter = true;
  }
  return field;
}

/** Prose between the `**Tag:**` line and the first `##` section, joined and unescaped. */
function extractDescription(lines: string[], tagLineIdx: number): string {
  const out: string[] = [];
  for (let i = tagLineIdx + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^##\s/.test(line)) {
      break;
    }
    if (line.trim() !== '') {
      out.push(line.trim());
    }
  }
  return htmlUnescape(out.join(' ')).trim();
}

/** Parse the `## Valid values` table, unwrapping each `` `'value'` `` cell. */
function extractEnumValues(lines: string[]): EnumValue[] {
  const headerIdx = lines.findIndex(
    (line) => isTableRow(line) && /\|\s*value\s*\|/i.test(line) && /description/i.test(line),
  );
  if (headerIdx === -1) {
    return [];
  }
  const values: EnumValue[] = [];
  const usedNames = new Map<string, number>();
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (!isTableRow(line)) {
      if (line.trim() === '') {
        continue;
      }
      break;
    }
    if (isTableDivider(line)) {
      continue;
    }
    const cells = tableCells(line);
    if (cells.length < 2) {
      continue;
    }
    const rawValue = cells[0]!.trim();
    const wrapped = rawValue.match(ENUM_WRAP);
    const value = wrapped ? wrapped[1]! : htmlUnescape(rawValue);
    const description = htmlUnescape(cells[1]!).trim();
    values.push({ value, name: uniqueName(value, description, usedNames), description });
  }
  return values;
}

function uniqueName(value: string, description: string, used: Map<string, number>): string {
  let base = sanitizeIdentifier(description) || `Value${sanitizeIdentifier(value) || 'X'}`;
  const seen = used.get(base);
  if (seen !== undefined) {
    used.set(base, seen + 1);
    base = `${base}_${seen + 1}`;
  } else {
    used.set(base, 0);
  }
  return base;
}

/**
 * Turn arbitrary prose into a PascalCase code identifier: remove parenthetical *segments*
 * (keeping any text before and after them, so "Network (Counterparty System) Status
 * Request" → `NetworkStatusRequest`, not a lossy `Network`), split on non-alphanumeric
 * runs, capitalise each token. Prefixes `_` when the result would start with a digit or be
 * empty. Exported for reuse when naming `MsgType` members.
 */
export function sanitizeIdentifier(text: string): string {
  const withoutParens = text.replace(/\([^)]*\)/g, ' ');
  const trimmed = withoutParens.replace(/[^A-Za-z0-9]+/g, ' ').trim() || text.trim();
  const words = trimmed.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const ident = words
    .map((w) => (/^[a-z]/.test(w) ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join('');
  if (!ident) {
    return '';
  }
  return /^[0-9]/.test(ident) ? `_${ident}` : ident;
}
