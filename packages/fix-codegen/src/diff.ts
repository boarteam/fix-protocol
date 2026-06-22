import type { DictionaryJSON, GroupMember, MemberRef } from '@boarteam/fix';
import { normalizeTypeName } from './quickfix';

/**
 * A single structural difference between two dictionaries, found by {@link diffDictionaries}.
 * Differences are data, not failures: the cross-check ({@link ./crosscheck}) partitions them
 * into *expected* (present in the committed allowlist baseline) and *unexpected* (drift that
 * must fail CI).
 *
 * {@link signature} is a stable, **value-bearing** identifier: it encodes not just *which*
 * field/message differs but *how* (the exact names/types/enum-deltas/reqd-flip/structure). So
 * a baseline keyed by signature accepts only the precise divergence it was recorded for — if
 * the divergence changes (a different rename, a flipped required flag, a new field in a
 * message), the signature changes and the difference is no longer explained.
 */
export interface Difference {
  category: DifferenceCategory;
  /** Stable locator within the category, e.g. `268` (a tag) or `W` (a msgType). */
  key: string;
  /** Human-readable specifics. */
  detail: string;
  /** Stable, value-bearing identifier used by the allowlist baseline. */
  signature: string;
  /** For field/structure diffs, the field tag(s) involved (used by the report/classifier). */
  tags?: number[];
}

export type DifferenceCategory =
  | 'field-only-in-md'
  | 'field-only-in-xml'
  | 'field-name'
  | 'field-type'
  | 'field-enum'
  | 'component-only-in-md'
  | 'component-only-in-xml'
  | 'message-only-in-md'
  | 'message-only-in-xml'
  | 'message-name'
  | 'message-category'
  | 'message-structure'
  | 'message-reqd';

/** Options for {@link diffDictionaries}. */
export interface DiffOptions {
  /**
   * Field tags to exclude from *both* dictionaries before comparing — used to factor out a
   * documented, accepted source difference (e.g. QuickFIX retaining FIX 4.4 deprecated fields
   * the primary Markdown reference omits). Excluded from field-level checks and from
   * structural expansion. The cross-check separately asserts the Markdown dictionary really
   * does not define these tags (so a future regression that adds one is not silently masked).
   */
  ignoreFields?: ReadonlySet<number>;
}

const MAX_DEPTH = 64;

/**
 * A component-expanded structural node. A group carries {@link SGroup.gap}: `true` when this
 * **specific occurrence** could not be reconstructed from the flattened Markdown source (its
 * body was filled from a canonical template — `bodyFromCanonical` — or left empty). Such an
 * occurrence is neutralised in the comparison; a *different* occurrence of the same counter
 * with a real inline body is **not** neutralised, so genuine drift inside it is still caught.
 */
type SNode = SField | SGroup;
interface SField {
  kind: 'field';
  tag: number;
  reqd: string;
}
interface SGroup {
  kind: 'group';
  counterTag: number;
  reqd: string;
  gap: boolean;
  body: SNode[];
}

/** Whether a Markdown-side group occurrence is a reconstruction gap (see {@link SGroup.gap}). */
function isGapOccurrence(m: GroupMember): boolean {
  return m.bodyFromCanonical === true || m.members.length === 0;
}

/**
 * Expand a member list into a flat structural tree, inlining every component reference
 * (recursively) so two dictionaries that *factor* the same fields into different components
 * still compare equal. `markGaps` is set only for the Markdown side, so the gap flag reflects
 * the authoritative source's reconstruction limits. Cycles and runaway depth are guarded.
 */
function expand(
  dict: DictionaryJSON,
  members: MemberRef[],
  ignore: ReadonlySet<number>,
  markGaps: boolean,
  seen: Set<string>,
  depth: number,
): SNode[] {
  const out: SNode[] = [];
  if (depth > MAX_DEPTH) {
    return out;
  }
  for (const m of members) {
    if (m.kind === 'field') {
      if (!ignore.has(m.tag)) {
        out.push({ kind: 'field', tag: m.tag, reqd: m.reqd });
      }
    } else if (m.kind === 'group') {
      out.push({
        kind: 'group',
        counterTag: m.counterTag,
        reqd: m.reqd,
        gap: markGaps && isGapOccurrence(m),
        body: expand(dict, m.members, ignore, markGaps, seen, depth + 1),
      });
    } else if (m.kind === 'component') {
      const comp = dict.components[m.name];
      if (comp && !seen.has(m.name)) {
        const next = new Set(seen);
        next.add(m.name);
        out.push(...expand(dict, comp.members, ignore, markGaps, next, depth + 1));
      }
      // A missing/cyclic component contributes nothing; absence is reported as component-only-*.
    }
  }
  return out;
}

/** Flatten a single node to its full token list (used when realignment is impossible). */
function flatten(node: SNode, out: string[]): void {
  if (node.kind === 'field') {
    out.push(`f${node.tag}`);
    return;
  }
  out.push(`g${node.counterTag}(`);
  if (node.gap) {
    out.push('GAP');
  } else {
    for (const c of node.body) {
      flatten(c, out);
    }
  }
  out.push(')');
}

interface TreeCompare {
  mdSig: string[];
  xmlSig: string[];
  reqd: string[];
}

/**
 * Compare two structural trees in lockstep, emitting a token stream for each side and the
 * `reqd` mismatches found where the structures align. A group occurrence the Markdown side
 * marks as a gap collapses to a single `GAP` token on both sides (its interior cannot be
 * compared); a non-gap group is compared recursively, so drift inside a resolved group body
 * is caught. On a structural misalignment the remaining nodes are flattened verbatim — that
 * yields a (deterministic) signature difference, which is exactly the drift signal wanted.
 */
function compareTree(md: SNode[], xml: SNode[]): TreeCompare {
  const mdSig: string[] = [];
  const xmlSig: string[] = [];
  const reqd: string[] = [];
  let i = 0;
  let j = 0;
  while (i < md.length || j < xml.length) {
    const a = md[i];
    const b = xml[j];
    const aligned =
      a !== undefined &&
      b !== undefined &&
      ((a.kind === 'field' && b.kind === 'field' && a.tag === b.tag) ||
        (a.kind === 'group' && b.kind === 'group' && a.counterTag === b.counterTag));
    if (aligned) {
      if (a.kind === 'field' && b.kind === 'field') {
        mdSig.push(`f${a.tag}`);
        xmlSig.push(`f${b.tag}`);
        if (a.reqd !== b.reqd) {
          reqd.push(`tag ${a.tag}: md=${a.reqd} xml=${b.reqd}`);
        }
      } else if (a.kind === 'group' && b.kind === 'group') {
        mdSig.push(`g${a.counterTag}(`);
        xmlSig.push(`g${b.counterTag}(`);
        if (a.reqd !== b.reqd) {
          reqd.push(`group ${a.counterTag}: md=${a.reqd} xml=${b.reqd}`);
        }
        if (a.gap) {
          mdSig.push('GAP');
          xmlSig.push('GAP');
        } else {
          const inner = compareTree(a.body, b.body);
          mdSig.push(...inner.mdSig);
          xmlSig.push(...inner.xmlSig);
          reqd.push(...inner.reqd);
        }
        mdSig.push(')');
        xmlSig.push(')');
      }
      i++;
      j++;
      continue;
    }
    if (a !== undefined) {
      flatten(a, mdSig);
      i++;
    }
    if (b !== undefined) {
      flatten(b, xmlSig);
      j++;
    }
  }
  return { mdSig, xmlSig, reqd };
}

/** The set of field tags in a tree, skipping gap-group interiors (per occurrence). */
function fieldTagSet(nodes: SNode[]): Set<number> {
  const out = new Set<number>();
  const walk = (ns: SNode[]): void => {
    for (const n of ns) {
      if (n.kind === 'field') {
        out.add(n.tag);
      } else if (!n.gap) {
        walk(n.body);
      }
    }
  };
  walk(nodes);
  return out;
}

/** Symmetric difference of two numeric sets, sorted ascending. */
function symDiff(a: Set<number>, b: Set<number>): number[] {
  const out: number[] = [];
  for (const x of a) {
    if (!b.has(x)) {
      out.push(x);
    }
  }
  for (const x of b) {
    if (!a.has(x)) {
      out.push(x);
    }
  }
  return out.sort((x, y) => x - y);
}

/** A short, stable hash of a string (djb2). Keeps long structural signatures bounded. */
function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = (h * 33) ^ s.charCodeAt(i);
  }
  return (h >>> 0).toString(36);
}

function valueSet(values?: { value: string }[]): Set<string> {
  return new Set((values ?? []).map((v) => v.value));
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) {
    return false;
  }
  for (const x of a) {
    if (!b.has(x)) {
      return false;
    }
  }
  return true;
}

/**
 * Compute the structural differences between two dictionaries. The first argument is the
 * authoritative shipped dictionary (the Markdown-generated one); the second is the cross-check
 * source (QuickFIX XML). Repeating-group occurrences the Markdown side could not reconstruct
 * are neutralised per occurrence (see {@link SGroup.gap}); fields in
 * {@link DiffOptions.ignoreFields} are excluded from both sides first.
 */
export function diffDictionaries(
  md: DictionaryJSON,
  xml: DictionaryJSON,
  options: DiffOptions = {},
): Difference[] {
  const ignore = options.ignoreFields ?? new Set<number>();
  const diffs: Difference[] = [];

  // --- Fields -------------------------------------------------------------------------
  const mdTags = new Set(
    Object.keys(md.fields)
      .map(Number)
      .filter((t) => !ignore.has(t)),
  );
  const xmlTags = new Set(
    Object.keys(xml.fields)
      .map(Number)
      .filter((t) => !ignore.has(t)),
  );
  for (const tag of [...mdTags].sort((a, b) => a - b)) {
    const mf = md.fields[tag]!;
    const xf = xml.fields[tag];
    if (!xf) {
      diffs.push({
        category: 'field-only-in-md',
        key: `${tag}`,
        detail: mf.name,
        signature: `field-only-in-md|${tag}`,
        tags: [tag],
      });
      continue;
    }
    if (mf.name !== xf.name) {
      diffs.push({
        category: 'field-name',
        key: `${tag}`,
        detail: `md=${mf.name} xml=${xf.name}`,
        signature: `field-name|${tag}|${mf.name}>${xf.name}`,
        tags: [tag],
      });
    }
    if (normalizeTypeName(mf.type) !== normalizeTypeName(xf.type)) {
      diffs.push({
        category: 'field-type',
        key: `${tag}`,
        detail: `md=${mf.type} xml=${xf.type}`,
        signature: `field-type|${tag}|${mf.type}>${xf.type}`,
        tags: [tag],
      });
    }
    const ms = valueSet(mf.enumValues);
    const xs = valueSet(xf.enumValues);
    if (!setsEqual(ms, xs)) {
      const onlyMd = [...ms].filter((v) => !xs.has(v)).sort();
      const onlyXml = [...xs].filter((v) => !ms.has(v)).sort();
      diffs.push({
        category: 'field-enum',
        key: `${tag}`,
        detail: `${mf.name}: +${onlyMd.length} only-md, +${onlyXml.length} only-xml`,
        signature: `field-enum|${tag}|md:${onlyMd.join(',')}|xml:${onlyXml.join(',')}`,
        tags: [tag],
      });
    }
  }
  for (const tag of [...xmlTags].filter((t) => !mdTags.has(t)).sort((a, b) => a - b)) {
    diffs.push({
      category: 'field-only-in-xml',
      key: `${tag}`,
      detail: xml.fields[tag]!.name,
      signature: `field-only-in-xml|${tag}`,
      tags: [tag],
    });
  }

  // --- Components (presence only; structure is compared via message expansion) ---------
  for (const name of Object.keys(md.components)) {
    if (!xml.components[name]) {
      diffs.push({
        category: 'component-only-in-md',
        key: name,
        detail: name,
        signature: `component-only-in-md|${name}`,
      });
    }
  }
  for (const name of Object.keys(xml.components)) {
    if (!md.components[name]) {
      diffs.push({
        category: 'component-only-in-xml',
        key: name,
        detail: name,
        signature: `component-only-in-xml|${name}`,
      });
    }
  }

  // --- Messages -----------------------------------------------------------------------
  const mdMsgs = new Map(md.messages.map((m) => [m.msgType, m]));
  const xmlMsgs = new Map(xml.messages.map((m) => [m.msgType, m]));
  for (const [msgType, mm] of mdMsgs) {
    const xm = xmlMsgs.get(msgType);
    if (!xm) {
      diffs.push({
        category: 'message-only-in-md',
        key: msgType,
        detail: mm.name,
        signature: `message-only-in-md|${msgType}`,
      });
      continue;
    }
    if (mm.name !== xm.name) {
      diffs.push({
        category: 'message-name',
        key: msgType,
        detail: `md=${mm.name} xml=${xm.name}`,
        signature: `message-name|${msgType}|${mm.name}>${xm.name}`,
      });
    }
    if (mm.category !== xm.category) {
      diffs.push({
        category: 'message-category',
        key: msgType,
        detail: `md=${mm.category} xml=${xm.category}`,
        signature: `message-category|${msgType}|${mm.category}>${xm.category}`,
      });
    }
    const mdTree = expand(md, mm.members, ignore, true, new Set(), 0);
    const xmlTree = expand(xml, xm.members, ignore, false, new Set(), 0);
    const cmp = compareTree(mdTree, xmlTree);
    if (cmp.mdSig.join(' ') !== cmp.xmlSig.join(' ')) {
      const sym = symDiff(fieldTagSet(mdTree), fieldTagSet(xmlTree));
      const structHash = hash(`${cmp.mdSig.join(' ')}||${cmp.xmlSig.join(' ')}`);
      diffs.push({
        category: 'message-structure',
        key: msgType,
        detail: `${mm.name}: differing tags [${sym.join(',')}]`,
        signature: `message-structure|${msgType}|tags:${sym.join(',')}|h:${structHash}`,
        tags: sym,
      });
    } else {
      for (const mismatch of cmp.reqd) {
        const m = mismatch.match(/^(tag|group) (\d+): md=(\S+) xml=(\S+)/);
        const tag = m ? Number(m[2]) : undefined;
        diffs.push({
          category: 'message-reqd',
          key: msgType,
          detail: `${mm.name}: ${mismatch}`,
          signature: m
            ? `message-reqd|${msgType}|${m[1]}${m[2]}|md=${m[3]}xml=${m[4]}`
            : `message-reqd|${msgType}|${mismatch}`,
          tags: tag !== undefined ? [tag] : undefined,
        });
      }
    }
  }
  for (const [msgType, xm] of xmlMsgs) {
    if (!mdMsgs.has(msgType)) {
      diffs.push({
        category: 'message-only-in-xml',
        key: msgType,
        detail: xm.name,
        signature: `message-only-in-xml|${msgType}`,
      });
    }
  }

  return diffs;
}
