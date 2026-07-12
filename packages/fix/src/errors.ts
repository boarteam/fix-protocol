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
 * The `dict/*` family is raised by `validateDictionary`, the `parse/*` family by `parse`,
 * the `validate/*` family (presence/enum/datatype/conditional) by `validate`, and the
 * `extend/*` family by `extendDictionary`. For `extend/*` codes the severity encodes the
 * outcome: `error` = the operation was skipped or reverted, `warning` = applied — or, for
 * `extend/duplicate-member`, already satisfied (the redundant member was not added again)
 * — but worth review, `info` = advisory.
 */
export type KnownIssueCode =
  // --- dictionary integrity (validateDictionary) ---
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
  | 'dict/unresolvable-group-delimiter'
  // --- message parsing (parse) ---
  // framing / structure
  | 'parse/empty-input'
  | 'parse/malformed-field'
  | 'parse/missing-begin-string'
  | 'parse/missing-body-length'
  | 'parse/missing-msgtype'
  | 'parse/framing-order'
  | 'parse/begin-string-mismatch'
  | 'parse/unknown-msgtype'
  | 'parse/missing-checksum'
  | 'parse/checksum-mismatch'
  | 'parse/body-length-mismatch'
  // fields & groups
  | 'parse/unknown-tag'
  | 'parse/tag-not-in-message'
  | 'parse/duplicate-tag'
  | 'parse/duplicate-group'
  | 'parse/invalid-group-count'
  | 'parse/group-count-mismatch'
  | 'parse/data-length-mismatch'
  // value coercion (datatypes)
  | 'parse/unknown-datatype'
  | 'parse/invalid-int'
  | 'parse/invalid-float'
  | 'parse/invalid-boolean'
  | 'parse/number-precision'
  // --- dictionary conformance (validate) ---
  // The MsgType is absent or not in the dictionary, so conformance cannot be checked.
  | 'validate/unknown-msgtype'
  // A required (`reqd: 'Y'`) field is absent from a scope that is present/required.
  | 'validate/required-field-missing'
  // A required repeating group is absent or has zero entries.
  | 'validate/required-group-missing'
  // A field is present on the wire but carries no value (`44=` then the separator).
  | 'validate/empty-value'
  // An enumerated field's value (or one token of a multi-valued field) is not in its
  // dictionary enum set.
  | 'validate/value-not-in-enum'
  // A field's value does not match the lexical format of its datatype (a malformed
  // integer/float/Boolean, a multi-character `char`, or a bad date/time/currency/country).
  | 'validate/invalid-value'
  // A field that a conditional rule makes required given the message's state is absent
  // (e.g. the `Length` companion of a present `data` field, or `OrigSendingTime` when
  // `PossDupFlag` = `Y`).
  | 'validate/conditional-required'
  // --- dictionary extension (extendDictionary) ---
  // fields
  // An extension field's tag already exists; the extension definition replaces it.
  // Suppressed when the redefinition is identical (idempotent re-application).
  | 'extend/field-tag-collision'
  // An extension field's name is already bound to a DIFFERENT tag; the field is skipped
  // (applying it would make the merged dictionary fail `dict/duplicate-field-name`).
  | 'extend/field-name-collision'
  // An extension field's tag is not a positive integer; the field is skipped.
  | 'extend/field-bad-tag'
  // An extension field's `type` names no datatype in the dictionary; the field is skipped.
  | 'extend/field-unknown-type'
  // A new field's tag lies outside the FIX user-defined ranges (5000-9999, 20000+).
  // Advisory only — venues do this in practice (e.g. cTrader's 1007/1008).
  | 'extend/tag-outside-user-range'
  // A new `data`-based field has no `lengthField`, so a value embedding the separator
  // cannot be scanned safely. Applied, but flagged.
  | 'extend/data-length-unwired'
  // enums
  // An `enums` entry names a field absent from the merged dictionary; the entry is skipped.
  | 'extend/enum-unknown-field'
  // An added enum value re-declares an existing wire value under a different name; the
  // extension entry replaces the base one. Identical value+name pairs dedupe silently.
  | 'extend/enum-value-conflict'
  // components & messages
  // A new component's name already exists; the definition is skipped (extend the existing
  // component with the append form instead).
  | 'extend/component-collision'
  // A component definition or placement would create a component reference cycle (which
  // the runtime cannot expand); the definition is deleted or the member reverted.
  | 'extend/component-cycle'
  // A new message re-uses an existing `MsgType`; the extension message REPLACES the base
  // message in place (an appended duplicate would be unreachable behind first-wins lookup).
  | 'extend/msgtype-collision'
  // A new message's name duplicates another message's name on a different `MsgType`
  // (mirrors the warning-level `dict/duplicate-message-name`). Applied.
  | 'extend/message-name-collision'
  // The base dictionary's Standard Message Header/Trailer refs were injected into a new
  // message that did not list them.
  | 'extend/header-trailer-injected'
  // No header/trailer component could be detected in the base dictionary; the new message
  // is applied without them (encode would silently drop session fields — review).
  | 'extend/header-trailer-missing'
  // placements
  // A placement target could not be resolved: unknown message/component name, ambiguous
  // message name, or a group path not reachable — including a group that lives behind a
  // shared component (the message carries a "reachable via component 'X'" hint).
  | 'extend/target-not-found'
  // A placed MemberSpec references a field/component name defined neither in the base
  // dictionary nor in the extension; the whole placement is skipped.
  | 'extend/unknown-member'
  // An `after` anchor matches no member of the resolved target body; the placement is skipped.
  | 'extend/member-not-found'
  // A placed member's identity (field tag / component name / group counter) already exists
  // in the target body; that member is skipped. This is the idempotency/overlap guard that
  // keeps re-applied or overlapping extensions from double-emitting tags on the wire.
  | 'extend/duplicate-member'
  // A new group's counter field's datatype does not derive from `NumInGroup` (mirrors
  // `dict/non-counter-group-head`). Applied — fix the field's type.
  | 'extend/counter-not-marked'
  // Post-condition check: the placement would change some group's resolved entry delimiter
  // (its first wire tag), breaking entry detection; the placement is reverted.
  | 'extend/group-delimiter-shift'
  // A placed member's tag also belongs to the scope (or is the delimiter) of a repeating
  // group that could be open on the wire right at the insertion point — either a group
  // before it (looking through optional members, which may be absent at runtime) or, for a
  // placed group, members that follow it. On re-parse the value would land in the wrong
  // entry. The member is skipped; anchor it with `after` elsewhere, or place it inside the
  // conflicting group instead.
  | 'extend/ambiguous-boundary'
  // A NEW repeating group's body resolves to no leading wire field, so the parser would
  // have no entry delimiter; the placement is skipped.
  | 'extend/unresolvable-group-delimiter'
  // A placed `data` field's Length companion (its FieldDef.lengthField) is not a member
  // positioned before it in the same body — encode would drop the caller-supplied length
  // and an SOH-embedding value would corrupt the frame. Applied; place the length field.
  | 'extend/data-length-not-placed'
  // A NumInGroup-derived field was placed as a plain scalar member; on the wire it heads
  // a repeating group, so real traffic would mis-parse. Applied — use the {group, members}
  // member form instead.
  | 'extend/counter-as-field'
  // An extension entry is structurally malformed (not an object, a message spec without a
  // members array, a non-array enum list, …); the entry is skipped.
  | 'extend/invalid-spec'
  // A placement gave a previously delimiter-less group body its first resolvable wire tag.
  | 'extend/delimiter-defined'
  // A placement touched a shared component; reports every message the addition now
  // reaches. Advisory — component reuse is the FIX model, but the fan-out should be known.
  | 'extend/component-fanout';

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
