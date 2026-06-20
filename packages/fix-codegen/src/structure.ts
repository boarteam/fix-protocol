import type { CoverageGap, MemberRef } from '@boarteam/fix';
import { htmlUnescape } from './markdown';
import type { TableRow } from './table';

/**
 * Context for {@link buildMembers}: how to recognise group counters and resolve component
 * references, plus the canonical-group registry and a sink for coverage gaps.
 */
export interface BuildContext {
  /** Whether a tag is a `NumInGroup` counter (heads a repeating group). */
  isCounter(tag: number): boolean;
  /** Map from a component file basename to its canonical (display) name. */
  componentNameByFile: Map<string, string>;
  /** The set of component names that actually resolved to a `ComponentDef`. */
  knownComponents: Set<string>;
  /** Canonical group bodies keyed by counter tag (see {@link harvestRegistry}). */
  registry: Map<number, TableRow[]>;
  /** Counters whose inline bodies disagree across the corpus (see {@link harvestRegistry}). */
  ambiguousCounters: Set<number>;
  /** Where we are, for gap messages (e.g. a message or component name). */
  where: string;
  /** Accumulated coverage gaps. */
  gaps: CoverageGap[];
}

/** The result of {@link harvestRegistry}: a canonical body per counter plus ambiguity. */
export interface HarvestResult {
  /** The chosen canonical body (smallest seen) per counter tag. */
  registry: Map<number, TableRow[]>;
  /** Counter tags that had more than one structurally-distinct inline body. */
  ambiguous: Set<number>;
}

/** A structural signature of a body, used to tell distinct bodies apart. */
function bodySignature(body: TableRow[]): string {
  return body
    .map((r) => (r.field ? `f${r.field.tag}@${r.depth}` : `c${r.component!.file}@${r.depth}`))
    .join(',');
}

/**
 * Harvest a canonical body for each repeating-group counter from every place the counter
 * appears at top level (depth 0) with an inline body. This backfills *nested* group
 * counters, which the flattened (single-`»`) Markdown leaves bodiless. When a counter has
 * several inline bodies across the corpus (e.g. `NoLegs` is `[Instrument Leg]` alone in
 * one message but `[Instrument Leg, Leg Stipulations, …]` in another), the smallest —
 * the pure component block — is kept as canonical and the counter is flagged
 * {@link HarvestResult.ambiguous} so callers can report the approximation honestly.
 * Deterministic given sorted input.
 */
export function harvestRegistry(
  rowLists: TableRow[][],
  isCounter: (tag: number) => boolean,
): HarvestResult {
  const registry = new Map<number, TableRow[]>();
  const signatures = new Map<number, Set<string>>();
  for (const rows of rowLists) {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      if (!row.field || row.depth !== 0 || !isCounter(row.field.tag)) {
        continue;
      }
      const body: TableRow[] = [];
      let j = i + 1;
      while (j < rows.length && rows[j]!.depth >= 1) {
        body.push({ ...rows[j]!, depth: rows[j]!.depth - 1 });
        j++;
      }
      if (body.length === 0) {
        continue;
      }
      const tag = row.field.tag;
      let seen = signatures.get(tag);
      if (!seen) {
        seen = new Set();
        signatures.set(tag, seen);
      }
      seen.add(bodySignature(body));
      const existing = registry.get(tag);
      if (!existing || body.length < existing.length) {
        registry.set(tag, body);
      }
    }
  }
  const ambiguous = new Set<number>();
  for (const [tag, sigs] of signatures) {
    if (sigs.size > 1) {
      ambiguous.add(tag);
    }
  }
  return { registry, ambiguous };
}

/**
 * Reconstruct the ordered member tree for one message or component from its parsed table
 * rows. Repeating groups are recovered from depth transitions: a counter at depth *d* owns
 * the following run of rows at depth > *d*. A counter with no inline body (a nested group,
 * since FIX 4.4 flattens at one `»`) is filled from the canonical registry and flagged
 * {@link GroupMember.bodyFromCanonical}; if the counter's bodies disagree across the
 * corpus, an `approximate-group` coverage gap is also recorded (the minimal body is used,
 * so message-specific members may be missing). If neither inline nor canonical body
 * exists, the group is emitted empty and an `unresolved-group` gap is recorded.
 */
export function buildMembers(
  rows: TableRow[],
  ctx: BuildContext,
  seenCounters: Set<number> = new Set(),
): MemberRef[] {
  const out: MemberRef[] = [];
  let i = 0;
  while (i < rows.length) {
    const row = rows[i]!;

    if (row.component) {
      out.push({ kind: 'component', name: resolveComponent(row.component, ctx), reqd: row.reqd });
      i++;
      continue;
    }
    if (!row.field) {
      i++;
      continue;
    }

    const tag = row.field.tag;
    if (!ctx.isCounter(tag)) {
      out.push({ kind: 'field', tag, reqd: row.reqd });
      i++;
      continue;
    }

    // Group counter: gather any inline body (rows deeper than this counter).
    const body: TableRow[] = [];
    let j = i + 1;
    while (j < rows.length && rows[j]!.depth > row.depth) {
      body.push({ ...rows[j]!, depth: rows[j]!.depth - 1 });
      j++;
    }

    let members: MemberRef[];
    let fromCanonical = false;
    if (body.length > 0) {
      members = buildMembers(body, ctx, seenCounters);
    } else if (ctx.registry.has(tag) && !seenCounters.has(tag)) {
      const next = new Set(seenCounters);
      next.add(tag);
      members = buildMembers(ctx.registry.get(tag)!, ctx, next);
      fromCanonical = true;
      if (ctx.ambiguousCounters.has(tag)) {
        ctx.gaps.push({
          kind: 'approximate-group',
          where: `${ctx.where}: NoXxx ${tag}`,
          detail: `Nested repeating group ${tag} was filled with the minimal canonical body; the spec defines context-varying bodies for this counter, so message-specific members may be missing.`,
        });
      }
    } else {
      members = [];
      ctx.gaps.push({
        kind: 'unresolved-group',
        where: `${ctx.where}: NoXxx ${tag}`,
        detail: `Nested repeating group ${tag} has no inline body in the spec and no canonical body could be resolved.`,
      });
    }

    out.push(
      fromCanonical
        ? { kind: 'group', counterTag: tag, reqd: row.reqd, members, bodyFromCanonical: true }
        : { kind: 'group', counterTag: tag, reqd: row.reqd, members },
    );
    i = j;
  }
  return out;
}

function resolveComponent(ref: { file: string; linkText: string }, ctx: BuildContext): string {
  const byFile = ctx.componentNameByFile.get(ref.file);
  const name = byFile ?? htmlUnescape(ref.linkText).replace(/[<>]/g, '').trim();
  if (!ctx.knownComponents.has(name)) {
    ctx.gaps.push({
      kind: 'unknown-component',
      where: ctx.where,
      detail: `Reference to component "${name}" (file ${ref.file}) could not be resolved to a definition.`,
    });
  }
  return name;
}
