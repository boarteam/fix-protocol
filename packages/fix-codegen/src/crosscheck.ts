import type { DictionaryJSON } from '@boarteam/fix';
import { diffDictionaries, type Difference } from './diff';

/**
 * Cross-check the Markdown-generated FIX 4.4 dictionary against the independently-maintained
 * QuickFIX `FIX44.xml` data dictionary, and partition the differences into **expected** (an
 * exact divergence recorded in the committed allowlist baseline) and **unexpected** (drift
 * that must fail CI).
 *
 * The Markdown reference (B2BITS FIXopaedia) is the project's *primary* source; QuickFIX is a
 * cross-check, not an override. The two encode the same protocol but make different editorial
 * choices — naming, datatype granularity, which fields they enumerate, optionality, and how
 * deeply they factor nested repeating groups. The gate does **not** accept whole categories or
 * tags wholesale; it accepts each difference only by its **exact value-bearing signature**
 * (see {@link Difference.signature}). Change the divergence in any way — a different rename, a
 * flipped required flag, a field gained or lost in a message, a different enum delta — and the
 * signature changes, the difference is no longer in the baseline, and CI fails. A previously
 * recorded difference that disappears is reported as *resolved* so the baseline stays honest.
 *
 * Regenerate the baseline after an intentional dictionary change with
 * `pnpm --filter @boarteam/fix-codegen crosscheck --write-baseline` and review the diff.
 */

/** A difference together with the cluster that documents *why* it is an accepted divergence. */
export interface ClassifiedDifference extends Difference {
  cluster: string;
}

export interface CrossCheckResult {
  /** Every difference found (after excluding {@link IGNORED_FIELDS}). */
  differences: Difference[];
  /** Each difference tagged with its documenting cluster. */
  classified: ClassifiedDifference[];
  /** Differences whose exact signature is not in the baseline — these fail the gate. */
  unexpected: ClassifiedDifference[];
  /** Baseline signatures that matched no current difference — stale; update the baseline. */
  resolved: string[];
  /** Counts of differences per category, for the report. */
  byCategory: Record<string, number>;
  /** Counts of differences per cluster, for the report. */
  byCluster: Record<string, number>;
}

/**
 * FIX 4.4 fields QuickFIX retains but the B2BITS Markdown reference omits because they were
 * **deprecated in FIX 4.4** (superseded by `CFICode`). They appear only inside the
 * `Instrument` / `UnderlyingInstrument` components in QuickFIX, so leaving them in would report
 * ~55 phantom message-structure diffs. Excluded from the comparison up front — but the cross
 * check separately asserts the Markdown dictionary really does not define them, so a future
 * regression that *adds* one is surfaced rather than silently masked.
 */
export const IGNORED_FIELDS = new Map<number, string>([
  [201, 'PutOrCall — deprecated in FIX 4.4 (use CFICode); retained by QuickFIX in Instrument'],
  [
    315,
    'UnderlyingPutOrCall — deprecated in FIX 4.4; retained by QuickFIX in UnderlyingInstrument',
  ],
]);

/** Human-readable reason for each documentation cluster (shown in the report and docs). */
export const CLUSTERS: Record<string, string> = {
  'nested-group-reconstruction':
    "The flattened single-`»` Markdown source under-specifies these messages' nested " +
    'repeating-group bodies; the shipped dictionary reconstructs them as best it can (see the ' +
    "dictionary's own coverageGaps) and differs from QuickFIX's fully-specified bodies.",
  'field-name-alias':
    'The two sources use different names for the same tag (e.g. B2BITS `IOIid` vs QuickFIX ' +
    '`IOIID`, `LinesOfText` vs `NoLinesOfText`). The shipped dictionary uses the B2BITS names.',
  'field-type-granularity':
    'The two sources pick different datatypes with the same base primitive (e.g. B2BITS `int` ' +
    'vs QuickFIX `SeqNum`/`char`); value coercion is driven by the base primitive.',
  'field-catalog':
    'A field one source defines and the other omits — each curates its own field catalog.',
  'enum-coverage':
    'The two sources enumerate different fields / value sets (e.g. B2BITS ships the ISO ' +
    'currency & country tables; QuickFIX enumerates some fields B2BITS leaves open).',
  'optionality-disagreement':
    "The sources disagree on a member's required-ness (`Y`/`N`) — mostly B2BITS marking " +
    'Instrument.Symbol / UnderlyingInstrument.UnderlyingSymbol required where QuickFIX does not.',
  'quickfix-no-conditional':
    'B2BITS marks the member conditionally-required (`C`); QuickFIX has no conditional concept ' +
    'and models it optional (`N`).',
  'naming-convention':
    'Cosmetic message display-name difference (`New Order - Single` vs `NewOrderSingle`); the ' +
    'MsgType and structure are identical.',
  'category-difference': 'The two sources classify the message admin/app differently.',
  'component-factoring':
    'The sources factor the same fields into differently-named components; because messages ' +
    'are compared with components expanded, this never changes the decoded field sequence.',
  'message-set-difference': 'A message present in one source and not the other.',
  'unexpected-ignored-field':
    'A field the cross-check excludes as QuickFIX-only deprecated was unexpectedly defined in ' +
    'the Markdown dictionary — investigate.',
};

/** The documenting cluster for a difference (for the report; not the gate decision). */
export function clusterFor(d: Difference): string {
  switch (d.category) {
    case 'message-structure':
      return 'nested-group-reconstruction';
    case 'field-name':
      return 'field-name-alias';
    case 'field-type':
      return 'field-type-granularity';
    case 'field-enum':
      return 'enum-coverage';
    case 'field-only-in-md':
      return d.signature.startsWith('ignored-field-defined')
        ? 'unexpected-ignored-field'
        : 'field-catalog';
    case 'field-only-in-xml':
      return 'field-catalog';
    case 'component-only-in-md':
    case 'component-only-in-xml':
      return 'component-factoring';
    case 'message-name':
      return 'naming-convention';
    case 'message-category':
      return 'category-difference';
    case 'message-reqd':
      return /md=C\b/.test(d.detail) ? 'quickfix-no-conditional' : 'optionality-disagreement';
    case 'message-only-in-md':
    case 'message-only-in-xml':
      return 'message-set-difference';
    default:
      return 'unknown';
  }
}

/**
 * A difference accepted by a sound *categorical* rule rather than by exact pinning: a member
 * the Markdown source marks conditionally-required (`C`) that QuickFIX models optional (`N`).
 * QuickFIX has no conditional concept, so every `C` necessarily becomes `N` there — pinning
 * each of the ~2000 such cases would bloat the baseline without adding soundness. The
 * dangerous required-ness changes (`Y`↔`N` flips, or `C` vs `Y`) are NOT rule-accepted; they
 * are pinned by exact signature like everything else, so an optionality regression still fails
 * the gate.
 */
export function isRuleAccepted(d: Difference): boolean {
  return d.category === 'message-reqd' && /\bmd=C xml=N\b/.test(d.detail);
}

/** Assert the Markdown dictionary does not define an excluded (deprecated) field. */
function ignoredFieldGuards(md: DictionaryJSON): Difference[] {
  const out: Difference[] = [];
  for (const tag of IGNORED_FIELDS.keys()) {
    if (md.fields[tag] !== undefined) {
      out.push({
        category: 'field-only-in-md',
        key: `${tag}`,
        detail: `Markdown dictionary unexpectedly defines excluded deprecated field ${tag} (${md.fields[tag]!.name})`,
        signature: `ignored-field-defined|${tag}`,
        tags: [tag],
      });
    }
  }
  return out;
}

/** Compute the full difference list (excluded-field guards + the structural diff). */
export function computeDifferences(md: DictionaryJSON, xml: DictionaryJSON): Difference[] {
  return [
    ...ignoredFieldGuards(md),
    ...diffDictionaries(md, xml, { ignoreFields: new Set(IGNORED_FIELDS.keys()) }),
  ];
}

/**
 * Run the cross-check, partitioning differences against an allowlist `baseline` of accepted
 * signatures. With an empty baseline every difference is unexpected (useful for `--write-baseline`).
 */
export function crossCheck(
  md: DictionaryJSON,
  xml: DictionaryJSON,
  baseline: ReadonlySet<string>,
): CrossCheckResult {
  const differences = computeDifferences(md, xml);
  const classified: ClassifiedDifference[] = differences.map((d) => ({
    ...d,
    cluster: clusterFor(d),
  }));

  const seen = new Set<string>();
  const unexpected: ClassifiedDifference[] = [];
  for (const d of classified) {
    if (isRuleAccepted(d)) {
      continue; // sound categorical acceptance; not pinned (see isRuleAccepted)
    }
    if (baseline.has(d.signature)) {
      seen.add(d.signature);
    } else {
      unexpected.push(d);
    }
  }
  const resolved = [...baseline].filter((s) => !seen.has(s)).sort();

  const byCategory: Record<string, number> = {};
  const byCluster: Record<string, number> = {};
  for (const d of classified) {
    byCategory[d.category] = (byCategory[d.category] ?? 0) + 1;
    byCluster[d.cluster] = (byCluster[d.cluster] ?? 0) + 1;
  }

  return { differences, classified, unexpected, resolved, byCategory, byCluster };
}

// --- Baseline file (the committed allowlist of accepted, exact divergences) --------------

/** One accepted-difference record in the baseline file. */
export interface BaselineEntry {
  signature: string;
  cluster: string;
  category: string;
  detail: string;
}

export interface Baseline {
  note: string;
  ignoredFields: Record<string, string>;
  entries: BaselineEntry[];
}

/** Build the baseline object from the current differences (for `--write-baseline`). */
export function buildBaseline(md: DictionaryJSON, xml: DictionaryJSON): Baseline {
  const entries = computeDifferences(md, xml)
    .filter((d) => !isRuleAccepted(d))
    .map((d) => ({
      signature: d.signature,
      cluster: clusterFor(d),
      category: d.category,
      detail: d.detail,
    }))
    .sort((a, b) => a.signature.localeCompare(b.signature));
  return {
    note:
      'Accepted, documented differences between the Markdown-generated FIX 4.4 dictionary and ' +
      'QuickFIX FIX44.xml. Each entry is pinned by its exact value-bearing signature; the CI ' +
      'drift gate fails on any difference not listed here, and on any listed difference that no ' +
      'longer occurs. Regenerate with `pnpm --filter @boarteam/fix-codegen crosscheck --write-baseline`.',
    ignoredFields: Object.fromEntries(IGNORED_FIELDS),
    entries,
  };
}

/** Parse a baseline file's JSON into the set of accepted signatures. */
export function baselineSignatures(baseline: Baseline): Set<string> {
  return new Set(baseline.entries.map((e) => e.signature));
}

/** Render a human-readable cross-check report (used by the CLI and committed as docs). */
export function renderReport(result: CrossCheckResult): string {
  const lines: string[] = [];
  lines.push('# FIX 4.4 cross-check: Markdown-generated dictionary vs QuickFIX FIX44.xml');
  lines.push('');
  lines.push(
    'Generated by `@boarteam/fix-codegen` (`crosscheck` command). The Markdown reference is the',
  );
  lines.push(
    'primary source; QuickFIX is an independent cross-check. Each difference is pinned by an',
  );
  lines.push(
    'exact signature in `crosscheck-baseline.json`; the CI drift gate fails on anything else.',
  );
  lines.push('');
  lines.push('## Fields excluded up front');
  lines.push('');
  for (const [tag, reason] of IGNORED_FIELDS) {
    lines.push(`- **${tag}** — ${reason}`);
  }
  lines.push('');
  lines.push('## Differences by category');
  lines.push('');
  for (const cat of Object.keys(result.byCategory).sort()) {
    lines.push(`- \`${cat}\`: ${result.byCategory[cat]}`);
  }
  lines.push('');
  lines.push('## Explained by cluster');
  lines.push('');
  for (const id of Object.keys(result.byCluster).sort()) {
    lines.push(`### ${id} (${result.byCluster[id]})`);
    lines.push('');
    lines.push(CLUSTERS[id] ?? '');
    lines.push('');
  }
  lines.push(`**Unexpected (drift): ${result.unexpected.length}** · `);
  lines.push(`**Resolved (stale baseline entries): ${result.resolved.length}**`);
  lines.push('');
  return lines.join('\n');
}
