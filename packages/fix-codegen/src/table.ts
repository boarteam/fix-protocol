import { isTableDivider, isTableRow, tableCells } from './markdown';

/** Required-ness as written in the spec. Mirrors the dictionary `Reqd` type. */
export type Reqd = 'Y' | 'N' | 'C';

/**
 * One parsed row of a message/component member table. Repeating-group membership is
 * carried by {@link depth} (the count of leading `»` markers, 0 or 1 in FIX 4.4); the
 * row is either a field reference or a component reference (empty Tag cell + `<Name>`).
 */
export interface TableRow {
  /** Nesting depth: number of leading `»` markers. */
  depth: number;
  /** Required-ness in this context. */
  reqd: Reqd;
  /** Set for a plain field reference. */
  field?: { tag: number; name: string };
  /** Set for a component reference; `file` is the link-target basename (no `.md`). */
  component?: { file: string; linkText: string };
}

const LINK = /\[([^\]]*)\]\(([^)]*)\)/;

function basename(target: string): string {
  const last = target.split('/').pop() ?? target;
  return last.replace(/\.md$/i, '');
}

function toReqd(cell: string): Reqd {
  const v = cell.trim().toUpperCase();
  return v === 'Y' || v === 'C' ? v : 'N';
}

/**
 * Parse the member table (`| Tag | Field Name | Req'd | Comments |`) out of a component
 * or message file's body lines into ordered {@link TableRow}s. Rows whose structure is
 * unrecognised are skipped. Returns `[]` if the file has no such table.
 */
export function parseMemberTable(lines: string[]): TableRow[] {
  const headerIdx = lines.findIndex(
    (line) => isTableRow(line) && /field name/i.test(line) && /req'?d/i.test(line),
  );
  if (headerIdx === -1) {
    return [];
  }

  const rows: TableRow[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (!isTableRow(line)) {
      if (line.trim() === '') {
        continue; // tolerate blank lines inside/after the table region
      }
      break; // table ended
    }
    if (isTableDivider(line)) {
      continue;
    }
    const cells = tableCells(line);
    if (cells.length < 3) {
      continue;
    }
    const tagCell = cells[0]!.trim();
    const nameCell = cells[1]!;
    const reqd = toReqd(cells[2]!);

    const depth = (nameCell.match(/»/g) ?? []).length;
    const link = nameCell.match(LINK);

    if (tagCell === '') {
      // Component reference: empty Tag cell, link text is `<Name>`.
      if (link) {
        rows.push({
          depth,
          reqd,
          component: { file: basename(link[2]!), linkText: link[1]!.trim() },
        });
      }
      continue;
    }

    const tag = Number(tagCell);
    if (!Number.isInteger(tag)) {
      continue; // not a numeric tag and not a component ref → skip defensively
    }
    const name = link ? link[1]!.replace(/»/g, '').trim() : nameCell.replace(/»/g, '').trim();
    rows.push({ depth, reqd, field: { tag, name } });
  }

  return rows;
}
