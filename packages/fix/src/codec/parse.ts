import type { Dictionary } from '../dictionary/Dictionary';
import type { MemberRef, MessageDef } from '../dictionary/types';
import { type FixIssue, issue } from '../errors';
import { calculateChecksum, bodyLength as byteLength } from './checksum';
import { type DecodedValue, decodeValue } from './datatypes';
import { scanFields, splitMessages } from './frame';
import { SOH, type Token } from './tokenize';
import type { EncodeMessage, GroupEntry } from './encode';

/**
 * One parsed scalar field. {@link raw} is the verbatim wire value and the **source of
 * truth** for re-encoding (so leading-zero codes, float formatting, and binary `data`
 * round-trip exactly); {@link value} is the typed convenience form, never used for
 * re-encode.
 */
export interface ParsedField {
  /** The field's numeric tag. */
  tag: number;
  /** The field's dictionary name, when the tag is known. */
  name?: string;
  /**
   * The wire value between `=` and the terminating separator, decoded as UTF-8. This is the
   * source of truth for re-encoding and round-trips exactly for textual values (ASCII,
   * UTF-8, Base64). Known limitation: a `data` field carrying *non-UTF-8 binary* is decoded
   * lossily (invalid bytes become U+FFFD) and is therefore not byte-preserved — a
   * byte-clean path would require representing values as bytes end-to-end.
   */
  raw: string;
  /** The coerced value (see {@link DecodedValue}); equals {@link raw} for string types. */
  value: DecodedValue;
}

/** One entry of a repeating group: its own fields and any nested groups, keyed by tag. */
export interface ParsedGroupEntry {
  /** Scalar fields of this entry, keyed by tag. */
  fields: Record<number, ParsedField>;
  /** Nested repeating groups within this entry, keyed by counter tag. */
  groups: Record<number, ParsedGroupEntry[]>;
}

/**
 * A parsed FIX message: a structured, nested view of one frame. Repeating groups are
 * reconstructed as arrays of objects (not parallel arrays). The shape mirrors
 * {@link EncodeMessage} so it re-encodes cheaply via {@link toEncodeMessage}.
 */
export interface ParsedMessage {
  /** The `MsgType` (tag 35) value, or `""` when absent. */
  msgType: string;
  /** The message's dictionary name, when the `MsgType` is known. */
  name?: string;
  /** The `BeginString` (tag 8) value, when present. */
  beginString?: string;
  /**
   * `true` when a well-formed frame was recognised: tags 8/9/35 lead in order and a
   * `CheckSum` (10) terminates it. Does not imply the checksum *matched* — see the issues.
   */
  framed: boolean;
  /** Top-level scalar fields keyed by tag (includes framing fields 8/9/35/10). */
  fields: Record<number, ParsedField>;
  /** Top-level repeating groups keyed by counter tag. */
  groups: Record<number, ParsedGroupEntry[]>;
}

/** The result of {@link parse}: the structured message plus any diagnostics. */
export interface ParseResult {
  message: ParsedMessage;
  issues: FixIssue[];
}

export interface ParseOptions {
  /** Field separator. Defaults to {@link SOH}. Pass `'|'` to read pipe-delimited logs. */
  soh?: string;
  /**
   * Verify the transport frame: the 8/9/35 leading triple, `BodyLength`, and `CheckSum`.
   * Defaults to `true`. Findings are returned as issues; the parse is never rejected. Set
   * `false` for fragments or pipe-delimited logs where framing is not meaningful.
   */
  checkFraming?: boolean;
}

const BEGIN_STRING = 8;
const BODY_LENGTH = 9;
const MSG_TYPE = 35;
const CHECK_SUM = 10;

/**
 * Parse one FIX message into a structured {@link ParsedMessage} with nested repeating
 * groups and coerced field values, returning diagnostics as data. **Never throws** — every
 * problem (malformed field, unknown tag, group-count mismatch, bad checksum, …) is a
 * returned {@link FixIssue}.
 *
 * If the input holds several concatenated messages, only the first frame is parsed; use
 * {@link parseAll} for the whole buffer.
 *
 * The parse is dictionary-driven: groups are reconstructed using each group's first body
 * field as the entry boundary (FIX has no group delimiters), and `data` fields whose value
 * may embed the separator are read by their preceding `Length` field. Field order in the
 * input is tolerated; the structure is what matters.
 *
 * When the `MsgType` is unknown to the dictionary (or absent), the message is parsed *flat*
 * — fields are kept at the top level with no group reconstruction, and a repeated tag is
 * reported (`parse/duplicate-tag`) keeping the first. A `parse/unknown-msgtype` issue is
 * also emitted.
 */
export function parse(
  raw: string | Uint8Array,
  dict: Dictionary,
  options: ParseOptions = {},
): ParseResult {
  const frames = splitMessages(raw, { soh: options.soh });
  // Fall back to the raw input when no `8=` frame was found, so fragments and
  // pipe-delimited logs (which splitMessages cannot frame) still parse.
  const frame = frames.length > 0 ? frames[0]! : toBytes(raw);
  return parseFrame(frame, dict, options);
}

/**
 * Parse every message in a buffer of concatenated frames. Returns one {@link ParseResult}
 * per message, in order; an empty array for empty input. Never throws.
 */
export function parseAll(
  raw: string | Uint8Array,
  dict: Dictionary,
  options: ParseOptions = {},
): ParseResult[] {
  const frames = splitMessages(raw, { soh: options.soh });
  if (frames.length === 0) {
    // No `8=` frame found. Mirror `parse`: treat a non-empty buffer as one fragment so a
    // header-less message or pipe-delimited log line is not silently dropped.
    const bytes = toBytes(raw);
    return bytes.length === 0 ? [] : [parseFrame(bytes, dict, options)];
  }
  return frames.map((frame) => parseFrame(frame, dict, options));
}

/**
 * Convert a {@link ParsedMessage} back into an {@link EncodeMessage} suitable for
 * {@link encode}, using each field's verbatim {@link ParsedField.raw} value so the
 * round-trip preserves the exact wire content. Framing fields (8/9/10) are carried but
 * ignored by the encoder, which recomputes them.
 */
export function toEncodeMessage(message: ParsedMessage): EncodeMessage {
  return {
    msgType: message.msgType,
    fields: rawFields(message.fields),
    groups: rawGroups(message.groups),
  };
}

const textEncoder = new TextEncoder();

function toBytes(raw: string | Uint8Array): Uint8Array {
  return typeof raw === 'string' ? textEncoder.encode(raw) : raw;
}

function rawFields(fields: Record<number, ParsedField>): Record<number, string> {
  const out: Record<number, string> = {};
  for (const pf of Object.values(fields)) {
    out[pf.tag] = pf.raw;
  }
  return out;
}

function rawGroups(groups: Record<number, ParsedGroupEntry[]>): Record<number, GroupEntry[]> {
  const out: Record<number, GroupEntry[]> = {};
  for (const [counter, entries] of Object.entries(groups)) {
    out[Number(counter)] = entries.map((e) => ({
      fields: rawFields(e.fields),
      groups: rawGroups(e.groups),
    }));
  }
  return out;
}

// --- the parser ------------------------------------------------------------------------

/**
 * A precomputed view of one structural scope (the message body or a group body): the field
 * tags that may appear directly in it (including child group counters), and its child
 * groups by counter tag. Components are expanded away.
 */
interface Scope {
  directTags: Set<number>;
  groups: Map<number, GroupScope>;
}
interface GroupScope extends Scope {
  counterTag: number;
  delimiterTag: number | undefined;
}

/** One frame of the parse stack: a target container plus the scope being filled. */
interface Frame {
  scope: Scope | undefined;
  /** Where fields/child-groups of the current position go (root body, or current entry). */
  target: ParsedGroupEntry;
  /** Prefix prepended to a field name to form its issue path (`""` or `…[i].`). */
  pathPrefix: string;
  // Group-only bookkeeping:
  isGroup: boolean;
  counterTag?: number;
  delimiterTag?: number;
  declaredCount?: number;
  entries?: ParsedGroupEntry[];
  entryIndex?: number;
  /** `${parentPrefix}${counterName}` — the dotless base for entry prefixes and mismatch paths. */
  groupBase?: string;
  /** A duplicate group at the same scope: its body is consumed but not attached (see openGroup). */
  discarded?: boolean;
}

function parseFrame(bytes: Uint8Array, dict: Dictionary, options: ParseOptions): ParseResult {
  const issues: FixIssue[] = [];
  const tokens = scanFields(bytes, dict, { soh: options.soh });

  const empty: ParsedMessage = { msgType: '', framed: false, fields: {}, groups: {} };
  if (tokens.length === 0) {
    issues.push(issue('parse/empty-input', 'Input contains no FIX fields.', { severity: 'info' }));
    return { message: empty, issues };
  }

  const beginStringToken = tokens.find(([t]) => t === BEGIN_STRING);
  const msgTypeToken = tokens.find(([t]) => t === MSG_TYPE);
  const msgType = msgTypeToken ? msgTypeToken[1] : '';
  const def = msgType ? dict.messageByMsgType(msgType) : undefined;

  const root: ParsedGroupEntry = { fields: {}, groups: {} };
  const scope = def ? buildScope(def.members, dict) : undefined;
  walkTokens(tokens, scope, dict, issues, root);

  const message: ParsedMessage = {
    msgType,
    name: def?.name,
    beginString: beginStringToken?.[1],
    framed: isFramed(tokens),
    fields: root.fields,
    groups: root.groups,
  };

  reportMessageIssues(msgType, def, dict, issues);
  if (options.checkFraming !== false) {
    checkFraming(bytes, tokens, dict, issues, options.soh);
  }

  return { message, issues };
}

/** Build the scope tree for a member list, expanding components and nesting groups. */
function buildScope(members: MemberRef[], dict: Dictionary): Scope {
  const scope: Scope = { directTags: new Set(), groups: new Map() };
  collectScope(members, dict, scope, new Set());
  return scope;
}

function collectScope(
  members: MemberRef[],
  dict: Dictionary,
  scope: Scope,
  seenComponents: Set<string>,
): void {
  for (const member of members) {
    switch (member.kind) {
      case 'field':
        scope.directTags.add(member.tag);
        break;
      case 'group': {
        scope.directTags.add(member.counterTag);
        const child = buildScope(member.members, dict) as GroupScope;
        child.counterTag = member.counterTag;
        child.delimiterTag = dict.groupDelimiterTag(member);
        scope.groups.set(member.counterTag, child);
        break;
      }
      case 'component': {
        if (seenComponents.has(member.name)) {
          break;
        }
        const component = dict.component(member.name);
        if (component) {
          const next = new Set(seenComponents);
          next.add(member.name);
          collectScope(component.members, dict, scope, next);
        }
        break;
      }
    }
  }
}

function walkTokens(
  tokens: Token[],
  scope: Scope | undefined,
  dict: Dictionary,
  issues: FixIssue[],
  root: ParsedGroupEntry,
): void {
  const stack: Frame[] = [{ scope, target: root, pathPrefix: '', isGroup: false }];

  for (const [tag, raw] of tokens) {
    if (Number.isNaN(tag)) {
      issues.push(
        issue('parse/malformed-field', `Malformed field segment "${raw}" (no valid tag).`, {
          severity: 'warning',
        }),
      );
      continue;
    }
    placeToken(tag, raw, stack, dict, issues);
  }

  // Close any still-open groups, reconciling their declared counts.
  while (stack.length > 1) {
    closeGroup(stack, issues);
  }
}

function placeToken(
  tag: number,
  raw: string,
  stack: Frame[],
  dict: Dictionary,
  issues: FixIssue[],
): void {
  // Walk outward from the innermost scope until the tag finds a home.
  for (;;) {
    const frame = stack[stack.length - 1]!;

    // A repeat of the current group's delimiter opens a new entry of that group.
    if (frame.isGroup && tag === frame.delimiterTag) {
      startEntry(frame);
      // A group whose first body member is itself a group has that nested group's counter
      // as its delimiter (see Dictionary.groupDelimiterTag): open the nested group rather
      // than recording the counter as a scalar.
      const childGroup = frame.scope?.groups.get(tag);
      if (childGroup) {
        openGroup(frame, childGroup, raw, stack, dict, issues);
      } else {
        addField(frame, tag, raw, dict, issues);
      }
      return;
    }

    const inScope = frame.scope?.directTags.has(tag) ?? false;
    if (inScope) {
      const childGroup = frame.scope!.groups.get(tag);
      if (childGroup) {
        openGroup(frame, childGroup, raw, stack, dict, issues);
      } else {
        addField(frame, tag, raw, dict, issues);
      }
      return;
    }

    // Not part of this scope: a group has ended — pop and retry against the parent.
    if (stack.length > 1) {
      closeGroup(stack, issues);
      continue;
    }

    // Top-level scope and the tag does not belong to the message: keep it (no data loss)
    // but flag it — only when the message structure is known (otherwise every field would
    // be flagged for an unknown MsgType, which is already reported once on its own).
    if (frame.scope !== undefined) {
      if (dict.fieldByTag(tag)) {
        issues.push(
          issue(
            'parse/tag-not-in-message',
            `Tag ${tag} (${dict.fieldByTag(tag)!.name}) is not defined for this message; kept at top level.`,
            {
              severity: 'warning',
              refTagID: tag,
            },
          ),
        );
      } else {
        issues.push(
          issue(
            'parse/unknown-tag',
            `Unknown tag ${tag} is not in the dictionary; kept at top level.`,
            {
              severity: 'info',
              refTagID: tag,
            },
          ),
        );
      }
    }
    addField(frame, tag, raw, dict, issues);
    return;
  }
}

function startEntry(frame: Frame): void {
  const entry: ParsedGroupEntry = { fields: {}, groups: {} };
  frame.entries!.push(entry);
  frame.target = entry;
  frame.entryIndex = (frame.entryIndex ?? -1) + 1;
  frame.pathPrefix = `${frame.groupBase}[${frame.entryIndex}].`;
}

function openGroup(
  parent: Frame,
  group: GroupScope,
  counterRaw: string,
  stack: Frame[],
  dict: Dictionary,
  issues: FixIssue[],
): void {
  const counterName = dict.fieldByTag(group.counterTag)?.name ?? `${group.counterTag}`;
  const groupBase = `${parent.pathPrefix}${counterName}`;

  let declared = 0;
  if (/^\d+$/.test(counterRaw)) {
    declared = Number(counterRaw);
  } else {
    issues.push(
      issue(
        'parse/invalid-group-count',
        `Group counter ${counterName} (${group.counterTag}) value "${counterRaw}" is not a non-negative integer; treated as 0.`,
        { refTagID: group.counterTag, path: groupBase },
      ),
    );
  }

  // A counter that already produced a group in this scope is a malformed duplicate. Mirror
  // the scalar "keep the first" rule (addField): report it and parse the duplicate into a
  // detached array so its entries neither overwrite the first group nor leak to the parent.
  const duplicate = parent.target.groups[group.counterTag] !== undefined;
  if (duplicate) {
    issues.push(
      issue(
        'parse/duplicate-group',
        `Group counter ${counterName} (${group.counterTag}) appears more than once in the same scope; keeping the first group's entries and discarding the rest.`,
        { severity: 'warning', refTagID: group.counterTag, path: groupBase },
      ),
    );
  }

  const entries: ParsedGroupEntry[] = [];
  if (!duplicate) {
    parent.target.groups[group.counterTag] = entries;
  }

  stack.push({
    scope: group,
    target: parent.target, // replaced by the first entry when the delimiter arrives
    pathPrefix: parent.pathPrefix,
    isGroup: true,
    counterTag: group.counterTag,
    delimiterTag: group.delimiterTag,
    declaredCount: declared,
    entries,
    entryIndex: -1,
    groupBase,
    discarded: duplicate,
  });
}

function closeGroup(stack: Frame[], issues: FixIssue[]): void {
  const frame = stack.pop()!;
  if (!frame.isGroup || frame.discarded) {
    // A discarded duplicate group already reported itself; its count is not meaningful.
    return;
  }
  const actual = frame.entries!.length;
  if (frame.declaredCount !== actual) {
    issues.push(
      issue(
        'parse/group-count-mismatch',
        `Group ${frame.groupBase} declared ${frame.declaredCount} entr${frame.declaredCount === 1 ? 'y' : 'ies'} but ${actual} ${actual === 1 ? 'was' : 'were'} parsed.`,
        { severity: 'warning', refTagID: frame.counterTag, path: frame.groupBase },
      ),
    );
  }
}

function addField(
  frame: Frame,
  tag: number,
  raw: string,
  dict: Dictionary,
  issues: FixIssue[],
): void {
  const field = dict.fieldByTag(tag);
  const name = field?.name;
  const path = `${frame.pathPrefix}${name ?? tag}`;

  let value: DecodedValue = raw;
  if (field) {
    const decoded = decodeValue(raw, field, dict, path);
    value = decoded.value;
    for (const di of decoded.issues) {
      issues.push(di);
    }
  }

  if (frame.target.fields[tag] !== undefined) {
    issues.push(
      issue(
        'parse/duplicate-tag',
        `Tag ${tag}${name ? ` (${name})` : ''} appears more than once in the same scope; keeping the first.`,
        { refTagID: tag, path },
      ),
    );
    return;
  }
  frame.target.fields[tag] = { tag, name, raw, value };
}

/** Whether the token stream opens with 8/9/35 in order and closes with a CheckSum. */
function isFramed(tokens: Token[]): boolean {
  return (
    tokens.length >= 4 &&
    tokens[0]![0] === BEGIN_STRING &&
    tokens[1]![0] === BODY_LENGTH &&
    tokens[2]![0] === MSG_TYPE &&
    tokens.some(([t]) => t === CHECK_SUM)
  );
}

/** Issues about the message as a whole: a missing or unknown MsgType. */
function reportMessageIssues(
  msgType: string,
  def: MessageDef | undefined,
  dict: Dictionary,
  issues: FixIssue[],
): void {
  if (!msgType) {
    issues.push(
      issue('parse/missing-msgtype', 'Message has no MsgType (tag 35).', { refTagID: MSG_TYPE }),
    );
    return;
  }
  if (!def) {
    issues.push(
      issue(
        'parse/unknown-msgtype',
        `MsgType "${msgType}" is not defined in dictionary ${dict.version}.`,
        { refMsgType: msgType, refTagID: MSG_TYPE },
      ),
    );
  }
}

function checkFraming(
  bytes: Uint8Array,
  tokens: Token[],
  dict: Dictionary,
  issues: FixIssue[],
  soh: string | undefined,
): void {
  const sep = soh ?? SOH;

  // 1. Leading triple presence + order.
  if (!tokens.some(([t]) => t === BEGIN_STRING)) {
    issues.push(
      issue('parse/missing-begin-string', 'Message has no BeginString (tag 8).', {
        refTagID: BEGIN_STRING,
      }),
    );
  } else if (tokens[0]![0] !== BEGIN_STRING) {
    issues.push(
      issue('parse/framing-order', 'BeginString (tag 8) must be the first field.', {
        refTagID: BEGIN_STRING,
      }),
    );
  }
  if (!tokens.some(([t]) => t === BODY_LENGTH)) {
    issues.push(
      issue('parse/missing-body-length', 'Message has no BodyLength (tag 9).', {
        refTagID: BODY_LENGTH,
      }),
    );
  } else if (tokens[1]?.[0] !== BODY_LENGTH) {
    issues.push(
      issue('parse/framing-order', 'BodyLength (tag 9) must be the second field.', {
        refTagID: BODY_LENGTH,
      }),
    );
  }
  if (tokens.some(([t]) => t === MSG_TYPE) && tokens[2]?.[0] !== MSG_TYPE) {
    issues.push(
      issue('parse/framing-order', 'MsgType (tag 35) must be the third field.', {
        refTagID: MSG_TYPE,
      }),
    );
  }

  // 2. BeginString value matches the dictionary dialect.
  const beginString = tokens.find(([t]) => t === BEGIN_STRING)?.[1];
  if (beginString !== undefined && beginString !== dict.beginString) {
    issues.push(
      issue(
        'parse/begin-string-mismatch',
        `BeginString "${beginString}" does not match dictionary "${dict.beginString}".`,
        { severity: 'warning', refTagID: BEGIN_STRING },
      ),
    );
  }

  // 3. BodyLength and CheckSum, computed on the raw BYTES (not a decoded string), so a
  // `data` field carrying non-UTF-8 binary does not skew the verdict via a lossy re-encode.
  const checkSumToken = tokens.find(([t]) => t === CHECK_SUM);
  if (!checkSumToken) {
    issues.push(
      issue('parse/missing-checksum', 'Message has no CheckSum (tag 10).', { refTagID: CHECK_SUM }),
    );
    return;
  }
  const sohByte = textEncoder.encode(sep)[0] ?? SOH.charCodeAt(0);
  const nineIdx = indexOfSeq(bytes, [0x39, 0x3d], 0); // "9="
  const tenIdx = lastIndexOfSeq(bytes, [sohByte, 0x31, 0x30, 0x3d]); // SOH + "10="
  if (nineIdx === -1 || tenIdx === -1) {
    return;
  }
  const ninthSoh = indexOfByte(bytes, sohByte, nineIdx); // the SOH terminating the 9= field
  if (ninthSoh === -1) {
    return;
  }
  const bodyStart = ninthSoh + 1;
  const bodyEndExclusive = tenIdx + 1; // up to & including the SOH before 10=

  const declaredBodyLength = tokens.find(([t]) => t === BODY_LENGTH)?.[1];
  if (declaredBodyLength !== undefined && /^\d+$/.test(declaredBodyLength)) {
    const actual = byteLength(bytes.subarray(bodyStart, bodyEndExclusive));
    if (Number(declaredBodyLength) !== actual) {
      issues.push(
        issue(
          'parse/body-length-mismatch',
          `BodyLength is ${declaredBodyLength} but the framed body is ${actual} bytes.`,
          { severity: 'warning', refTagID: BODY_LENGTH },
        ),
      );
    }
  }

  const expected = calculateChecksum(bytes.subarray(0, bodyEndExclusive));
  if (checkSumToken[1] !== expected) {
    issues.push(
      issue(
        'parse/checksum-mismatch',
        `CheckSum is ${checkSumToken[1]} but the computed value is ${expected}.`,
        { refTagID: CHECK_SUM },
      ),
    );
  }
}

/** Index of the first byte equal to `b` at or after `from`, or -1. */
function indexOfByte(bytes: Uint8Array, b: number, from: number): number {
  for (let i = from; i < bytes.length; i++) {
    if (bytes[i] === b) {
      return i;
    }
  }
  return -1;
}

/** Index of the first occurrence of byte sequence `seq` at or after `from`, or -1. */
function indexOfSeq(bytes: Uint8Array, seq: number[], from: number): number {
  outer: for (let i = Math.max(0, from); i <= bytes.length - seq.length; i++) {
    for (let k = 0; k < seq.length; k++) {
      if (bytes[i + k] !== seq[k]) {
        continue outer;
      }
    }
    return i;
  }
  return -1;
}

/** Index of the last occurrence of byte sequence `seq`, or -1. */
function lastIndexOfSeq(bytes: Uint8Array, seq: number[]): number {
  outer: for (let i = bytes.length - seq.length; i >= 0; i--) {
    for (let k = 0; k < seq.length; k++) {
      if (bytes[i + k] !== seq[k]) {
        continue outer;
      }
    }
    return i;
  }
  return -1;
}
