import type { Dictionary } from '../dictionary/Dictionary';
import type { FieldDef } from '../dictionary/types';
import { type FixIssue, issue } from '../errors';

/**
 * A FIX field value after datatype coercion:
 * - `number` for `int`/`float` families,
 * - `boolean` for `Boolean`,
 * - `string[]` for `MultipleValueString`,
 * - `string` for everything else (plain strings, enums, dates, currency/country codes, and
 *   `data` — all kept verbatim).
 *
 * When a value cannot be coerced to its declared type (e.g. `"x"` for an `int` field), the
 * raw string is returned unchanged and an `error` {@link FixIssue} is reported, so a single
 * malformed field never corrupts the rest of the parse and re-encoding still round-trips.
 */
export type DecodedValue = number | boolean | string | string[];

/** The result of coercing one wire value: the decoded value plus any diagnostics. */
export interface DecodeResult {
  value: DecodedValue;
  issues: FixIssue[];
}

/** FIX `int`: optional sign then one or more digits. Leading zeros are allowed (`"00023"`). */
export const INT_RE = /^[+-]?\d+$/;
/**
 * FIX `float`: optional sign, digits with an optional decimal point (`"23"`, `"23."`,
 * `"23.5"`, `".5"`, `"00023.230"`). Leading/trailing zeros are allowed. Shared with the
 * validator so wire decoding (`parse`) and conformance (`validate`) never disagree on what
 * a valid number looks like.
 */
export const FLOAT_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;

/**
 * Coerce one raw wire value to its typed form per the field's datatype.
 *
 * Design rules:
 * - **Multi-value lists split first.** A `MultipleValueString` field (e.g. `ExecInst`)
 *   splits into a `string[]` of its space-delimited tokens *before* enum opacity applies,
 *   because such fields are enumerated *per token* — the result is a list of opaque enum
 *   tokens (`"1 2 5"` → `["1", "2", "5"]`) the M3 validator can check element-by-element.
 * - **Enumerated single values are opaque.** A non-list field with an `enumValues` table
 *   keeps its raw string (`"1"`, `"004"`, `"USD"`) — never a number — so leading-zero codes
 *   survive and enum membership (checked by the M3 validator) compares like-for-like.
 * - **Dates/times stay strings.** `UTCTimestamp`/`UTCDateOnly`/`LocalMktDate`/`month-year`
 *   are returned verbatim; the engine is pure and deterministic and does not introduce a
 *   `Date` (which would entangle time zones and lose the on-the-wire form).
 * - **Floats keep their wire form for re-encode** via the raw string the parser retains
 *   alongside this value; the `number` here is a convenience that may lose insignificant
 *   digits (`"23.0"` → `23`), so it is never the source of truth for round-tripping.
 *
 * Never throws.
 *
 * @param raw The verbatim characters between `=` and the terminating separator.
 * @param field The field definition that types the value.
 * @param dict The dictionary, used to resolve the datatype's base and flags.
 * @param path Dotted location for any reported issue (e.g. `"NoMDEntries[1].MDEntryPx"`).
 */
export function decodeValue(
  raw: string,
  field: FieldDef,
  dict: Dictionary,
  path?: string,
): DecodeResult {
  const resolved = dict.resolveDatatype(field.type);
  // Unknown datatype: surface it but keep the raw value usable.
  if (!resolved) {
    return {
      value: raw,
      issues: [
        issue(
          'parse/unknown-datatype',
          `Field ${field.name} (${field.tag}) has unknown datatype "${field.type}"; value left as a string.`,
          { severity: 'warning', refTagID: field.tag, path },
        ),
      ],
    };
  }

  // A multi-value list (e.g. MultipleValueString) splits into tokens first — this takes
  // precedence over enum opacity, since such fields are enumerated per token.
  if (resolved.multiValueDelimiter !== undefined) {
    return { value: raw.split(resolved.multiValueDelimiter), issues: [] };
  }

  // A single enumerated value is an opaque on-the-wire token regardless of base type.
  if (field.enumValues && field.enumValues.length > 0) {
    return { value: raw, issues: [] };
  }

  switch (resolved.base) {
    case 'int':
      return coerceInt(raw, field, path);
    case 'float':
      return coerceFloat(raw, field, path);
    case 'char':
      return resolved.isBoolean ? coerceBoolean(raw, field, path) : { value: raw, issues: [] };
    case 'String':
      return { value: raw, issues: [] };
    case 'data':
      // Kept verbatim — the value may legitimately contain the SOH separator. See the note
      // on UTF-8 decoding in `scanFields`: non-UTF-8 binary payloads are not byte-preserved.
      return { value: raw, issues: [] };
    default:
      return { value: raw, issues: [] };
  }
}

function coerceInt(raw: string, field: FieldDef, path?: string): DecodeResult {
  if (!INT_RE.test(raw)) {
    return {
      value: raw,
      issues: [
        issue(
          'parse/invalid-int',
          `Field ${field.name} (${field.tag}) value "${raw}" is not a valid integer.`,
          { refTagID: field.tag, path },
        ),
      ],
    };
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) {
    // Preserve the exact digits and warn rather than silently rounding to a lossy number.
    return {
      value: raw,
      issues: [
        issue(
          'parse/number-precision',
          `Field ${field.name} (${field.tag}) value "${raw}" exceeds the safe integer range; left as a string.`,
          { severity: 'warning', refTagID: field.tag, path },
        ),
      ],
    };
  }
  return { value, issues: [] };
}

function coerceFloat(raw: string, field: FieldDef, path?: string): DecodeResult {
  if (!FLOAT_RE.test(raw)) {
    return {
      value: raw,
      issues: [
        issue(
          'parse/invalid-float',
          `Field ${field.name} (${field.tag}) value "${raw}" is not a valid float.`,
          { refTagID: field.tag, path },
        ),
      ],
    };
  }
  return { value: Number(raw), issues: [] };
}

function coerceBoolean(raw: string, field: FieldDef, path?: string): DecodeResult {
  if (raw === 'Y') {
    return { value: true, issues: [] };
  }
  if (raw === 'N') {
    return { value: false, issues: [] };
  }
  return {
    value: raw,
    issues: [
      issue(
        'parse/invalid-boolean',
        `Field ${field.name} (${field.tag}) value "${raw}" is not a FIX Boolean ("Y" or "N").`,
        { refTagID: field.tag, path },
      ),
    ],
  };
}
