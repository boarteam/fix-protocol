import type { ParsedMessage } from '../codec/parse';
import type { Dictionary } from '../dictionary/Dictionary';
import type { MessageDef } from '../dictionary/types';
import { type FixIssue, issue } from '../errors';

/**
 * FIX `SessionRejectReason` (tag 373) = 21, "Conditionally required field missing". Attached
 * to every issue a conditional rule raises so callers can build a session-level `Reject`.
 */
export const CONDITIONALLY_REQUIRED_FIELD_MISSING = 21;

/**
 * The read-only view of one message a {@link ConditionalRule} reasons over. A rule inspects
 * top-level fields by tag (or, for dialect-robustness, by spec name) and returns any
 * conditional-presence violations it finds. Group-internal conditions are out of scope for
 * v0.1 (a declared coverage gap — see the package README).
 */
export interface ConditionalContext {
  /** The message being validated. */
  readonly message: ParsedMessage;
  /** The resolved definition for {@link ParsedMessage.msgType}. */
  readonly def: MessageDef;
  /** The dictionary, for resolving field names → tags and datatypes. */
  readonly dict: Dictionary;
  /** The verbatim wire value of a top-level field, or `undefined` if it is absent. */
  field(tag: number): string | undefined;
  /** Whether a top-level field is present. */
  has(tag: number): boolean;
  /** The verbatim wire value of a top-level field looked up by its spec name. */
  fieldByName(name: string): string | undefined;
}

/**
 * A conditional ("C", required-by-prose) presence rule. Given a message's state, it returns
 * the {@link FixIssue}s for any conditionally-required field that is missing (or any
 * forbidden field that is present). Pure and total: it must not throw and must tolerate a
 * dictionary that lacks the fields it references (return `[]`), so a rule written for FIX
 * 4.4 is harmless on a custom dialect.
 *
 * Supply extra rules via {@link ../validate/validate.ValidateOptions.conditionalRules}.
 */
export type ConditionalRule = (ctx: ConditionalContext) => FixIssue[];

/**
 * The canonical FIX 4.4 conditional rule the engine ships with: `OrigSendingTime` (122) is
 * required whenever `PossDupFlag` (43) is `Y` (a possible-duplicate retransmission must
 * carry the original send time). Resolved by field name so it no-ops on a dialect that
 * lacks either field.
 */
export const origSendingTimeWhenPossDup: ConditionalRule = (ctx) => {
  const possDup = ctx.dict.fieldByName('PossDupFlag');
  const origSendingTime = ctx.dict.fieldByName('OrigSendingTime');
  if (!possDup || !origSendingTime) {
    return [];
  }
  if (ctx.field(possDup.tag) === 'Y' && !ctx.has(origSendingTime.tag)) {
    return [
      issue(
        'validate/conditional-required',
        `${origSendingTime.name} (${origSendingTime.tag}) is required when ${possDup.name} (${possDup.tag}) = Y.`,
        {
          refTagID: origSendingTime.tag,
          sessionRejectReason: CONDITIONALLY_REQUIRED_FIELD_MISSING,
        },
      ),
    ];
  }
  return [];
};

/**
 * The built-in conditional rules. Deliberately small: only the mechanically-unambiguous
 * session-layer rule lives here. The bulk of FIX 4.4's `C` requirements are free-text prose
 * (a declared v0.1 coverage gap); the `data`→`Length` companion rule, which *is* mechanical,
 * is derived from the dictionary inside the value walk rather than hand-listed here.
 */
export const DEFAULT_CONDITIONAL_RULES: readonly ConditionalRule[] = [origSendingTimeWhenPossDup];

/**
 * Evaluate a set of conditional rules against a parsed message, collecting their issues.
 * Each rule is isolated: a rule that throws is swallowed (the validator never throws) and
 * contributes nothing, so one buggy custom rule cannot abort the whole validation.
 */
export function runConditionalRules(
  message: ParsedMessage,
  def: MessageDef,
  dict: Dictionary,
  rules: readonly ConditionalRule[],
  issues: FixIssue[],
): void {
  const ctx: ConditionalContext = {
    message,
    def,
    dict,
    field: (tag) => message.fields[tag]?.raw,
    has: (tag) => message.fields[tag] !== undefined,
    fieldByName: (name) => {
      const field = dict.fieldByName(name);
      return field ? message.fields[field.tag]?.raw : undefined;
    },
  };
  for (const rule of rules) {
    let found: FixIssue[] | undefined;
    try {
      found = rule(ctx);
    } catch {
      // A custom rule must not be able to crash validation; treat a throw as "no findings".
      continue;
    }
    // A misbehaving rule may also return a non-array; ignore it rather than throwing on the
    // `for…of`, so the never-throw contract holds for any custom rule.
    if (!Array.isArray(found)) {
      continue;
    }
    for (const i of found) {
      issues.push(i);
    }
  }
}
