import type { ParsedField, ParsedGroupEntry, ParsedMessage } from '../codec/parse';
import { FLOAT_RE, INT_RE } from '../codec/datatypes';
import type { Dictionary, ResolvedDatatype } from '../dictionary/Dictionary';
import type { FieldDef, MemberRef } from '../dictionary/types';
import { type FixIssue, issue } from '../errors';
import {
  CONDITIONALLY_REQUIRED_FIELD_MISSING,
  type ConditionalRule,
  DEFAULT_CONDITIONAL_RULES,
  runConditionalRules,
} from './conditions';

export type { ConditionalContext, ConditionalRule } from './conditions';

/** Relevant FIX `SessionRejectReason` (tag 373) codes, attached to issues for callers. */
const REQUIRED_TAG_MISSING = 1;
const TAG_SPECIFIED_WITHOUT_A_VALUE = 4;
const VALUE_IS_INCORRECT = 5;
const INCORRECT_DATA_FORMAT_FOR_VALUE = 6;
const INVALID_MSG_TYPE = 11;

/** Options for {@link validate}. */
export interface ValidateOptions {
  /**
   * Extra conditional-presence rules, evaluated after the built-ins. Use this to model the
   * `C` (required-by-prose) rules the engine does not ship — see {@link ConditionalRule}.
   */
  conditionalRules?: ConditionalRule[];
  /**
   * Whether to run the built-in conditional rules ({@link DEFAULT_CONDITIONAL_RULES}).
   * Defaults to `true`; set `false` to run only your own {@link ValidateOptions.conditionalRules}.
   */
  useDefaultConditionalRules?: boolean;
}

/** The minimal structural shape both {@link ParsedMessage} and {@link ParsedGroupEntry} share. */
interface Container {
  fields: Record<number, ParsedField>;
  groups: Record<number, ParsedGroupEntry[]>;
}

// Format patterns for the verbatim (string-kept) datatypes the parser does not coerce. The
// fractional part of the time types is left open (`\.\d+`) rather than pinned to milliseconds
// so sub-millisecond precision, common at venues, is not flagged as malformed.
const UTC_TIMESTAMP_RE = /^\d{8}-\d{2}:\d{2}:\d{2}(?:\.\d+)?$/;
const UTC_TIME_RE = /^\d{2}:\d{2}:\d{2}(?:\.\d+)?$/;
const DATE_RE = /^\d{8}$/;
// YYYYMM[DD|wWW] per the spec: month 01-12, optional day 01-31 or week w1-w5. Case-sensitive
// (the spec defines the week marker only in lowercase).
const MONTH_YEAR_RE = /^\d{4}(?:0[1-9]|1[0-2])(?:(?:0[1-9]|[12]\d|3[01])|w[1-5])?$/;
const CURRENCY_RE = /^[A-Za-z]{3}$/;
const COUNTRY_RE = /^[A-Za-z]{2}$/;

/**
 * Datatype names that carry a lexical format the parser keeps verbatim. {@link checkFormat}
 * resolves a field's nearest such ancestor (not just its literal datatype name) so a custom
 * datatype derived from one of these is still format-validated.
 */
const FORMAT_NAMES = new Set([
  'UTCTimestamp',
  'UTCTimeOnly',
  'UTCDateOnly',
  'LocalMktDate',
  'month-year',
  'Currency',
  'Country',
]);

/**
 * A backstop against a pathological untrusted dictionary (a very deep, acyclic component or
 * group chain): presence recursion stops past this depth so the never-throw contract holds
 * even for a dictionary that was never run through `validateDictionary`. Real FIX nesting is
 * well under ten levels.
 */
const MAX_NESTING_DEPTH = 256;

/**
 * Validate a parsed FIX message against a dictionary, returning diagnostics as data. **Never
 * throws** — every conformance problem is a returned {@link FixIssue}.
 *
 * The checks are the dictionary-conformance complement to {@link ../codec/parse.parse}, which
 * owns wire decoding (framing, group reconstruction, numeric/Boolean coercion, group-count
 * consistency). `validate` adds, over the structured message:
 * - **presence** — every required (`reqd: 'Y'`) field/group is present, gated by its
 *   ancestry: a required field inside an *optional, absent* component is not required;
 * - **enum membership** — an enumerated field's value (each token, for multi-valued fields)
 *   is one of its dictionary values;
 * - **value format** — the verbatim datatypes the parser keeps as strings (dates, times,
 *   `month-year`, currency, country) are well-formed, single-character `char`s are one
 *   character, and numbers/Booleans are lexically valid;
 * - **empty values** — a tag present with no value is rejected;
 * - **conditional rules** — the `data`→`Length` companion (derived from the dictionary) plus
 *   {@link DEFAULT_CONDITIONAL_RULES} and any caller-supplied rules.
 *
 * The value, enum, and empty checks run on every field in the parsed tree, so they work even
 * when the `MsgType` is unknown (the structure is then flat); presence and conditional checks
 * need the message definition and are skipped with a single `validate/unknown-msgtype` notice
 * when it is missing.
 *
 * `validate` is **self-contained**: it re-derives every conformance fact from the message and
 * the dictionary, so it gives a complete verdict on a hand-built or post-parse-mutated
 * {@link ParsedMessage} without needing the parse issues. As a result one class of problem —
 * a number/Boolean field whose value is lexically invalid (`44=abc`) or empty (`44=`) — is
 * reported by *both* passes under distinct codes (`parse/invalid-float` from decoding;
 * `validate/invalid-value` or `validate/empty-value` from conformance). Everything else is
 * disjoint: framing, group reconstruction, and group-count consistency are parse-only;
 * presence, enum membership, conditional rules, and the formats the parser keeps verbatim are
 * validate-only. Concatenate both lists for the full picture and dedupe by `(refTagID, path)`
 * if the numeric double-report is unwanted.
 *
 * @param message A {@link ParsedMessage} (typically from {@link ../codec/parse.parse}).
 * @param dict The dictionary to validate against.
 * @param options See {@link ValidateOptions}.
 */
export function validate(
  message: ParsedMessage,
  dict: Dictionary,
  options: ValidateOptions = {},
): FixIssue[] {
  const issues: FixIssue[] = [];
  const enumCache = new Map<number, Set<string>>();

  // Per-field value checks (enum, format, empty, data/Length companion) need no message
  // definition, so they run even on a flat-parsed message with an unknown MsgType.
  walkValues(message, dict, issues, enumCache, '');

  const def = message.msgType ? dict.messageByMsgType(message.msgType) : undefined;
  if (!def) {
    issues.push(
      issue(
        'validate/unknown-msgtype',
        message.msgType
          ? `MsgType "${message.msgType}" is not defined in dictionary ${dict.version}; conformance not checked.`
          : 'Message has no MsgType (tag 35); conformance not checked.',
        {
          severity: 'warning',
          refMsgType: message.msgType || undefined,
          sessionRejectReason: INVALID_MSG_TYPE,
        },
      ),
    );
    return issues;
  }

  checkPresence(def.members, message, true, dict, issues, '', new Set(), 0);

  const rules: ConditionalRule[] = [
    ...(options.useDefaultConditionalRules === false ? [] : DEFAULT_CONDITIONAL_RULES),
    ...(options.conditionalRules ?? []),
  ];
  runConditionalRules(message, def, dict, rules, issues);

  return issues;
}

// --- value checks (enum / format / empty / data→Length) --------------------------------

/** Recursively check every present field's value, descending into group entries. */
function walkValues(
  container: Container,
  dict: Dictionary,
  issues: FixIssue[],
  enumCache: Map<number, Set<string>>,
  pathPrefix: string,
): void {
  for (const pf of Object.values(container.fields)) {
    checkValue(pf, container, dict, issues, enumCache, `${pathPrefix}${pf.name ?? pf.tag}`);
  }
  for (const [counter, entries] of Object.entries(container.groups)) {
    const counterName = dict.fieldByTag(Number(counter))?.name ?? counter;
    entries.forEach((entry, i) =>
      walkValues(entry, dict, issues, enumCache, `${pathPrefix}${counterName}[${i}].`),
    );
  }
}

function checkValue(
  pf: ParsedField,
  container: Container,
  dict: Dictionary,
  issues: FixIssue[],
  enumCache: Map<number, Set<string>>,
  path: string,
): void {
  const field = dict.fieldByTag(pf.tag);
  if (!field) {
    // An unknown tag is already reported by `parse`; there is no datatype to conform to.
    return;
  }
  const raw = pf.raw;
  if (raw === '') {
    issues.push(
      issue(
        'validate/empty-value',
        `Field ${field.name} (${field.tag}) is present but has no value.`,
        { refTagID: field.tag, path, sessionRejectReason: TAG_SPECIFIED_WITHOUT_A_VALUE },
      ),
    );
    return;
  }

  const resolved = dict.resolveDatatype(field.type);

  // A multi-valued field (e.g. MultipleValueString) is enumerated per token.
  if (resolved?.multiValueDelimiter !== undefined) {
    if (field.enumValues && field.enumValues.length > 0) {
      const set = enumSet(field, enumCache);
      const tokens = raw.split(resolved.multiValueDelimiter);
      tokens.forEach((token, i) => {
        if (token !== '' && !set.has(token)) {
          issues.push(
            issue(
              'validate/value-not-in-enum',
              `Field ${field.name} (${field.tag}) token "${token}" is not an allowed value.`,
              {
                refTagID: field.tag,
                path: `${path}[${i}]`,
                sessionRejectReason: VALUE_IS_INCORRECT,
              },
            ),
          );
        }
      });
    }
    return;
  }

  // A single enumerated value is opaque: validate membership, not the base format. Boolean
  // fields are excluded even when they list `Y`/`N` as enum values, so a bad Boolean is
  // always reported as `invalid-value` (SessionRejectReason 6) by the format check below,
  // never as `value-not-in-enum` — keeping the classification of a bad Boolean consistent.
  if (field.enumValues && field.enumValues.length > 0 && !resolved?.isBoolean) {
    if (!enumSet(field, enumCache).has(raw)) {
      issues.push(
        issue(
          'validate/value-not-in-enum',
          `Field ${field.name} (${field.tag}) value "${raw}" is not an allowed value.`,
          { refTagID: field.tag, path, sessionRejectReason: VALUE_IS_INCORRECT },
        ),
      );
    }
    return;
  }

  if (!resolved) {
    // Unknown datatype — `parse` already warned; nothing to conform-check.
    return;
  }

  // A present `data` field requires its companion `Length` field in the same scope (a
  // mechanical, dictionary-derived conditional rule).
  if (resolved.lengthPrefixed && field.lengthField !== undefined) {
    if (container.fields[field.lengthField] === undefined) {
      const lenField = dict.fieldByTag(field.lengthField);
      issues.push(
        issue(
          'validate/conditional-required',
          `${lenField?.name ?? 'Length'} (${field.lengthField}) is required because data field ${field.name} (${field.tag}) is present.`,
          {
            refTagID: field.lengthField,
            path,
            sessionRejectReason: CONDITIONALLY_REQUIRED_FIELD_MISSING,
          },
        ),
      );
    }
    return; // `data` has no further lexical format constraint.
  }

  const formatIssue = checkFormat(raw, field, resolved, dict, path);
  if (formatIssue) {
    issues.push(formatIssue);
  }
}

/** The nearest format-bearing datatype name in a field's derivation chain, if any. */
function namedFormat(dict: Dictionary, typeName: string): string | undefined {
  const seen = new Set<string>();
  let name: string | undefined = typeName;
  while (name && !seen.has(name)) {
    if (FORMAT_NAMES.has(name)) {
      return name;
    }
    seen.add(name);
    name = dict.datatype(name)?.parent;
  }
  return undefined;
}

/** Validate a non-empty, non-enum value against its datatype's lexical format. */
function checkFormat(
  raw: string,
  field: FieldDef,
  resolved: ResolvedDatatype,
  dict: Dictionary,
  path: string,
): FixIssue | undefined {
  // Named datatypes (resolved through the derivation chain) whose base is `String` but which
  // carry a format (dates/times/codes), so a custom datatype derived from one is also checked.
  const named = namedFormat(dict, field.type);
  switch (named) {
    case 'UTCTimestamp':
      return UTC_TIMESTAMP_RE.test(raw) ? undefined : badFormat(field, raw, 'UTCTimestamp', path);
    case 'UTCTimeOnly':
      return UTC_TIME_RE.test(raw) ? undefined : badFormat(field, raw, 'UTCTimeOnly', path);
    case 'UTCDateOnly':
    case 'LocalMktDate':
      return DATE_RE.test(raw) ? undefined : badFormat(field, raw, named, path);
    case 'month-year':
      return MONTH_YEAR_RE.test(raw) ? undefined : badFormat(field, raw, 'month-year', path);
    case 'Currency':
      // ISO 4217 is a heuristic, not a closed set in the dictionary: warn, don't reject.
      return CURRENCY_RE.test(raw)
        ? undefined
        : badFormat(field, raw, 'Currency (ISO 4217)', path, 'warning');
    case 'Country':
      return COUNTRY_RE.test(raw)
        ? undefined
        : badFormat(field, raw, 'Country (ISO 3166)', path, 'warning');
  }

  switch (resolved.base) {
    case 'int':
      return INT_RE.test(raw) ? undefined : badFormat(field, raw, 'int', path);
    case 'float':
      return FLOAT_RE.test(raw) ? undefined : badFormat(field, raw, 'float', path);
    case 'char':
      if (resolved.isBoolean) {
        return raw === 'Y' || raw === 'N'
          ? undefined
          : badFormat(field, raw, 'Boolean (Y/N)', path);
      }
      // A plain `char` is exactly one character.
      return [...raw].length === 1 ? undefined : badFormat(field, raw, 'char', path);
    default:
      // `String`, `data`, and other free-form types impose no lexical format.
      return undefined;
  }
}

function badFormat(
  field: FieldDef,
  raw: string,
  expected: string,
  path: string,
  severity: 'error' | 'warning' = 'error',
): FixIssue {
  return issue(
    'validate/invalid-value',
    `Field ${field.name} (${field.tag}) value "${raw}" is not a valid ${expected}.`,
    { severity, refTagID: field.tag, path, sessionRejectReason: INCORRECT_DATA_FORMAT_FOR_VALUE },
  );
}

function enumSet(field: FieldDef, cache: Map<number, Set<string>>): Set<string> {
  let set = cache.get(field.tag);
  if (!set) {
    set = new Set(field.enumValues?.map((e) => e.value));
    cache.set(field.tag, set);
  }
  return set;
}

// --- presence checks -------------------------------------------------------------------

/**
 * Walk a member list against a container, reporting absent required members. `active` carries
 * whether this branch is required at all: it starts `true` for the message body, stays `true`
 * through required components, and becomes `false` inside an optional component that is absent
 * from the container — so a required field only matters when its enclosing optional component
 * is actually present (standard FIX requiredness gating).
 */
function checkPresence(
  members: MemberRef[],
  container: Container,
  active: boolean,
  dict: Dictionary,
  issues: FixIssue[],
  pathPrefix: string,
  seenComponents: Set<string>,
  depth: number,
): void {
  if (depth > MAX_NESTING_DEPTH) {
    return;
  }
  for (const member of members) {
    switch (member.kind) {
      case 'field': {
        if (active && member.reqd === 'Y' && container.fields[member.tag] === undefined) {
          const name = dict.fieldByTag(member.tag)?.name ?? `${member.tag}`;
          issues.push(
            issue(
              'validate/required-field-missing',
              `Required field ${name} (${member.tag}) is missing.`,
              {
                refTagID: member.tag,
                path: `${pathPrefix}${name}`,
                sessionRejectReason: REQUIRED_TAG_MISSING,
              },
            ),
          );
        }
        break;
      }
      case 'group': {
        const entries = container.groups[member.counterTag];
        const present = entries !== undefined && entries.length > 0;
        const counterName = dict.fieldByTag(member.counterTag)?.name ?? `${member.counterTag}`;
        if (active && member.reqd === 'Y' && !present) {
          issues.push(
            issue(
              'validate/required-group-missing',
              `Required group ${counterName} (${member.counterTag}) is missing or empty.`,
              {
                refTagID: member.counterTag,
                path: `${pathPrefix}${counterName}`,
                sessionRejectReason: REQUIRED_TAG_MISSING,
              },
            ),
          );
        }
        if (present) {
          // Every entry that exists must satisfy the group body's own required members.
          entries.forEach((entry, i) =>
            checkPresence(
              member.members,
              entry,
              true,
              dict,
              issues,
              `${pathPrefix}${counterName}[${i}].`,
              new Set(),
              depth + 1,
            ),
          );
        }
        break;
      }
      case 'component': {
        if (seenComponents.has(member.name)) {
          break; // cycle guard (validateDictionary flags the cycle itself)
        }
        const component = dict.component(member.name);
        if (!component) {
          break;
        }
        const compActive =
          active &&
          (member.reqd === 'Y' ||
            componentPresent(component.members, container, dict, new Set(), depth));
        // Backtracking guard (O(depth), not O(depth^2) Set copies): mark this component while
        // recursing into it, then unmark so a sibling reference to it is still evaluated.
        seenComponents.add(member.name);
        // Components are inlined: their members live in the same container/scope.
        checkPresence(
          component.members,
          container,
          compActive,
          dict,
          issues,
          pathPrefix,
          seenComponents,
          depth + 1,
        );
        seenComponents.delete(member.name);
        break;
      }
    }
  }
}

/** Whether any field or non-empty group the component contributes to this scope is present. */
function componentPresent(
  members: MemberRef[],
  container: Container,
  dict: Dictionary,
  seen: Set<string>,
  depth: number,
): boolean {
  if (depth > MAX_NESTING_DEPTH) {
    return false;
  }
  for (const member of members) {
    switch (member.kind) {
      case 'field':
        if (container.fields[member.tag] !== undefined) {
          return true;
        }
        break;
      case 'group': {
        // An empty group counter (`NoXxx=0` → `groups[counter] = []`) is not "present": it
        // must not activate an optional component and make its required fields mandatory.
        const entries = container.groups[member.counterTag];
        if (entries !== undefined && entries.length > 0) {
          return true;
        }
        break;
      }
      case 'component': {
        if (seen.has(member.name)) {
          break;
        }
        seen.add(member.name);
        const nested = dict.component(member.name);
        if (nested && componentPresent(nested.members, container, dict, seen, depth + 1)) {
          return true;
        }
        break;
      }
    }
  }
  return false;
}
