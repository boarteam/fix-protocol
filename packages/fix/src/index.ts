/**
 * `@boarteam/fix` — a dictionary-driven FIX protocol toolkit.
 *
 * Parse, validate, and encode FIX messages with zero runtime dependencies, in the
 * browser or Node. See the README and `docs/PROJECT_PLAN.md` for the roadmap; this
 * package is in early (0.x) development.
 */

export const VERSION = '0.1.0-alpha.0';

// Codec primitives.
export { calculateChecksum, bodyLength } from './codec/checksum';
export { tokenize, SOH } from './codec/tokenize';
export type { Token, TokenizeOptions } from './codec/tokenize';
export { encode } from './codec/encode';
export type { EncodeMessage, EncodeOptions, GroupEntry, FieldValue } from './codec/encode';
export { splitMessages, scanFields } from './codec/frame';
export type { FrameOptions } from './codec/frame';

// Parse path.
export { parse, parseAll, toEncodeMessage } from './codec/parse';
export type {
  ParseResult,
  ParseOptions,
  ParsedMessage,
  ParsedField,
  ParsedGroupEntry,
} from './codec/parse';
export { decodeValue } from './codec/datatypes';
export type { DecodedValue, DecodeResult } from './codec/datatypes';

// Validate path.
export { validate } from './validate/validate';
export type { ValidateOptions } from './validate/validate';
export { DEFAULT_CONDITIONAL_RULES } from './validate/conditions';
export type { ConditionalRule, ConditionalContext } from './validate/conditions';

// Engine façade.
export { createFixEngine } from './engine';
export type { FixEngine, EngineOptions } from './engine';

// Dictionary runtime + contract.
export { Dictionary, loadDictionary } from './dictionary/Dictionary';
export type { ResolvedDatatype } from './dictionary/Dictionary';
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
export type { FixIssue, FixSeverity, KnownIssueCode } from './errors';
