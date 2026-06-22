/**
 * `@boarteam/fix-codegen` — generates the FIX dictionary JSON consumed by
 * `@boarteam/fix-dict-fix44` from the FIX 4.4 Markdown reference. Node-only build tool;
 * never shipped to consumers. See `cli.ts` for the command-line entry point.
 */

export { generate } from './generate';
export type { GenerateResult } from './generate';
export { emitDictionaryJson, emitIndexTs } from './emit';
export { parseDatatypes } from './datatypes';
export { parseField, sanitizeIdentifier } from './fields';
export { parseMemberTable } from './table';
export type { TableRow, Reqd } from './table';
export { buildMembers, harvestRegistry } from './structure';
export type { BuildContext } from './structure';
export { htmlUnescape, bodyLines, heading } from './markdown';

// QuickFIX-XML cross-check path (the canonical drift gate against the Markdown-generated dict).
export { parseXml, parseQuickFix, normalizeTypeName } from './quickfix';
export { diffDictionaries } from './diff';
export type { Difference, DifferenceCategory, DiffOptions } from './diff';
export {
  crossCheck,
  computeDifferences,
  clusterFor,
  buildBaseline,
  baselineSignatures,
  renderReport,
  CLUSTERS,
  IGNORED_FIELDS,
} from './crosscheck';
export type { CrossCheckResult, ClassifiedDifference, Baseline, BaselineEntry } from './crosscheck';
