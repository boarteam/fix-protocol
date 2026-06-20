import type { BaseType, DataTypeDef } from '@boarteam/fix';
import { bodyLines, htmlUnescape, isTableDivider, isTableRow, tableCells } from './markdown';

const ROOTS = new Set<BaseType>(['int', 'float', 'char', 'String', 'data']);

/** Format hints for the date/time/period types (the spec states these in prose). */
const FORMAT_PATTERNS: Record<string, string> = {
  UTCTimestamp: 'YYYYMMDD-HH:MM:SS[.sss]',
  UTCTimeOnly: 'HH:MM:SS[.sss]',
  UTCDateOnly: 'YYYYMMDD',
  LocalMktDate: 'YYYYMMDD',
  'month-year': 'YYYYMM[DD|WW]',
};

/**
 * Parse `data-types.md` into datatype definitions. The catalog is a single
 * `| Name | Description |` table whose `»`-prefixed rows derive from the nearest
 * preceding non-prefixed root, so parent/base are tracked positionally. Escaped pipes in
 * descriptions (e.g. `\|21=723\|`) are handled by the shared cell splitter.
 */
export function parseDatatypes(content: string): Record<string, DataTypeDef> {
  const lines = bodyLines(content);
  const headerIdx = lines.findIndex(
    (line) => isTableRow(line) && /\|\s*name\s*\|/i.test(line) && /description/i.test(line),
  );
  const datatypes: Record<string, DataTypeDef> = {};
  if (headerIdx === -1) {
    return datatypes;
  }

  let currentRoot: BaseType | undefined;
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
    const nameCell = cells[0]!;
    const derived = nameCell.includes('»');
    const name = nameCell.replace(/»/g, '').trim();
    if (!name) {
      continue;
    }
    const description = htmlUnescape(cells[1]!).trim();

    if (!derived) {
      const base = (ROOTS.has(name as BaseType) ? name : name) as BaseType;
      currentRoot = base;
      datatypes[name] = {
        name,
        base,
        ...patternFor(name),
        ...(name === 'data' ? { lengthPrefixed: true } : {}),
        description,
      };
    } else {
      const base = currentRoot ?? 'String';
      datatypes[name] = {
        name,
        base,
        parent: currentRoot,
        ...patternFor(name),
        ...(name === 'MultipleValueString' ? { multiValueDelimiter: ' ' } : {}),
        description,
      };
    }
  }

  return datatypes;
}

function patternFor(name: string): { formatPattern?: string } {
  const pattern = FORMAT_PATTERNS[name];
  return pattern ? { formatPattern: pattern } : {};
}
