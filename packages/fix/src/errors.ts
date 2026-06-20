/**
 * Severity of a {@link FixIssue}. `error` marks the message (or dictionary) invalid;
 * `warning` flags something suspect that does not by itself make the input unusable;
 * `info` is advisory (e.g. an unknown-but-tolerated tag).
 */
export type FixSeverity = 'error' | 'warning' | 'info';

/**
 * The catalogue of issue codes the engine currently emits. Codes are part of the public
 * SemVer contract, so this union documents the known set and gives callers autocompletion
 * and exhaustiveness — while {@link FixIssue.code} stays open (`KnownIssueCode | string`)
 * so a custom dictionary or future milestone can introduce new codes without a type break.
 * The `dict/*` family is raised by `validateDictionary`; `parse`/`validate` codes land in
 * M2/M3.
 */
export type KnownIssueCode =
  | 'dict/missing-version'
  | 'dict/missing-begin-string'
  | 'dict/missing-datatypes'
  | 'dict/missing-fields'
  | 'dict/missing-components'
  | 'dict/missing-messages'
  | 'dict/datatype-cycle'
  | 'dict/datatype-missing-parent'
  | 'dict/datatype-bad-base'
  | 'dict/field-key-mismatch'
  | 'dict/field-bad-tag'
  | 'dict/field-unknown-type'
  | 'dict/duplicate-field-name'
  | 'dict/duplicate-enum-value'
  | 'dict/message-missing-msgtype'
  | 'dict/duplicate-msgtype'
  | 'dict/duplicate-message-name'
  | 'dict/unknown-field-ref'
  | 'dict/unknown-component-ref'
  | 'dict/component-cycle'
  | 'dict/unknown-group-counter'
  | 'dict/non-counter-group-head'
  | 'dict/empty-group'
  | 'dict/unresolvable-group-delimiter';

/**
 * A single diagnostic, returned as data — never thrown — by every analysis entry point
 * (`parse`, `validate`, `validateDictionary`). This is the demoted, structured successor
 * to the legacy `FixProtocolException`: the same FIX session-reject context
 * (`refTagID`/`refSeqNum`/`refMsgType`/`sessionRejectReason`) survives, but as fields on a
 * value the caller inspects rather than a control-flow exception.
 *
 * Issue {@link code}s are part of the package's public contract and follow SemVer: a
 * stable, machine-readable identifier (see {@link KnownIssueCode}).
 */
export interface FixIssue {
  /** Stable, machine-readable identifier for the kind of problem (see {@link KnownIssueCode}). */
  code: KnownIssueCode | (string & {});
  /** How serious the issue is. */
  severity: FixSeverity;
  /** Human-readable explanation. Not stable across versions; do not match on it. */
  message: string;
  /**
   * Dotted path to the offending location within the parsed structure, when applicable
   * (e.g. `"NoMDEntries[2].MDEntryType"`). Absent for whole-message issues.
   */
  path?: string;
  /** The tag the issue concerns (FIX `RefTagID`, tag 371). */
  refTagID?: number;
  /** The sequence number of the offending message (FIX `RefSeqNum`, tag 45). */
  refSeqNum?: number;
  /** The `MsgType` of the offending message (FIX `RefMsgType`, tag 372). */
  refMsgType?: string;
  /**
   * The FIX `SessionRejectReason` (tag 373) code, when the issue maps to one. Kept as a
   * number to avoid coupling the engine to a particular dictionary's enum.
   */
  sessionRejectReason?: number;
}

/**
 * Construct a {@link FixIssue}, filling in defaults. Internal helper; not part of the
 * public API surface.
 */
export function issue(
  code: KnownIssueCode | (string & {}),
  message: string,
  extra: Partial<Omit<FixIssue, 'code' | 'message'>> = {},
): FixIssue {
  return { code, severity: 'error', message, ...extra };
}
