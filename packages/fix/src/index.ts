/**
 * `@boarteam/fix` — a dictionary-driven FIX protocol toolkit.
 *
 * Parse, validate, and encode FIX messages with zero runtime dependencies, in the
 * browser or Node. See the README and `docs/PROJECT_PLAN.md` for the roadmap; this
 * package is in early (0.x) development — `parse`/`validate` land in M2/M3.
 */

export const VERSION = '0.1.0-alpha.0';

// Codec primitives.
export { calculateChecksum, bodyLength } from './codec/checksum';
export { tokenize, SOH } from './codec/tokenize';
export type { Token, TokenizeOptions } from './codec/tokenize';
export { encode } from './codec/encode';
export type { EncodeMessage, EncodeOptions, GroupEntry, FieldValue } from './codec/encode';

// Dictionary runtime + contract.
export { Dictionary, loadDictionary } from './dictionary/Dictionary';
export { validateDictionary } from './dictionary/validateDictionary';
export type {
  DictionaryJSON,
  DataTypeDef,
  BaseType,
  EnumValue,
  FieldDef,
  MemberRef,
  FieldMember,
  ComponentMember,
  GroupMember,
  ComponentDef,
  MessageDef,
  MessageCategory,
  Reqd,
  CoverageGap,
} from './dictionary/types';

// Diagnostics.
export type { FixIssue, FixSeverity } from './errors';
