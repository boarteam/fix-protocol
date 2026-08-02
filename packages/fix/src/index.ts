/**
 * `@boarteam/fix` — a dictionary-driven FIX protocol toolkit.
 *
 * Parse, validate, and encode FIX messages with zero runtime dependencies, in the
 * browser or Node. See the README and `docs/ROADMAP.md` for the roadmap; this
 * package is in early (0.x) development.
 */

export const VERSION = '0.4.0';

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

// Typed, self-rendering Message API.
export { createMessage, createImmutableMessage, messageFactory, messageTypeGuard } from './message';
export type {
  MessageView,
  MutableMessage,
  ImmutableMessage,
  MessageFactory,
  MessageTypeGuard,
  MessageOf,
  MessageInit,
  FieldInit,
  Envelope,
  UntypedBody,
} from './message';

// Dictionary runtime + contract.
export { Dictionary, loadDictionary } from './dictionary/Dictionary';
export type { ResolvedDatatype } from './dictionary/Dictionary';

// FIXT transport/application split.
export { isFixtDictionaries, mergeFixtDictionaries } from './dictionary/fixt';
export type { FixtDictionaries } from './dictionary/fixt';
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

// Dictionary extension helpers (typed maps).
export { extendTags, invertTags, extendMsgTypes, invertMsgTypes } from './dictionary/extendTags';
export type {
  ExtendTags,
  InvertTags,
  ExtendMsgTypes,
  InvertMsgTypes,
} from './dictionary/extendTags';

// Dictionary extension (runtime merge + one-declaration bridge).
export { extendDictionary } from './dictionary/extendDictionary';
export type { ExtendResult } from './dictionary/extendDictionary';
export { defineExtension, tagsOf, msgTypesOf } from './dictionary/extension';
export type {
  DictionaryExtension,
  ExtensionFieldDef,
  ExtensionEnumValue,
  MemberSpec,
  GroupExtension,
  MessageExtension,
  NewMessageSpec,
  ComponentExtension,
  TagsOf,
  MsgTypesOf,
  GuardWidening,
  WidenedExtensionError,
} from './dictionary/extension';

// Diagnostics.
export type { FixIssue, FixSeverity, FixLayer, KnownIssueCode } from './errors';
