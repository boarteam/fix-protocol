import { type EncodeMessage, type EncodeOptions, encode } from './codec/encode';
import {
  type ParseOptions,
  type ParseResult,
  type ParsedMessage,
  parse,
  parseAll,
} from './codec/parse';
import { Dictionary, loadDictionary } from './dictionary/Dictionary';
import type { DictionaryJSON } from './dictionary/types';
import type { FixIssue } from './errors';
import { type ValidateOptions, validate } from './validate/validate';

/** Defaults applied to every call, overridable per call. */
export interface EngineOptions {
  /** Field separator for parse/encode. Defaults to `SOH`. */
  soh?: string;
  /** Verify the transport frame on parse (see {@link ParseOptions.checkFraming}). */
  checkFraming?: boolean;
}

/**
 * A dictionary-bound façade over the stateless codec: `parse`/`parseAll`/`encode` with the
 * dictionary and default options already applied. Holds no session state (sequence numbers,
 * timestamps, comp-IDs) — it is a thin, pure convenience over the free functions, which
 * remain available for callers who prefer to pass the dictionary explicitly.
 */
export interface FixEngine {
  /** The runtime dictionary this engine is bound to. */
  readonly dictionary: Dictionary;
  /** Parse the first message in the input. See {@link parse}. */
  parse(raw: string | Uint8Array, options?: ParseOptions): ParseResult;
  /** Parse every message in a concatenated buffer. See {@link parseAll}. */
  parseAll(raw: string | Uint8Array, options?: ParseOptions): ParseResult[];
  /** Encode a message into a framed FIX string. See {@link encode}. */
  encode(message: EncodeMessage, options?: EncodeOptions): string;
  /** Validate a parsed message against the dictionary. See {@link validate}. */
  validate(message: ParsedMessage, options?: ValidateOptions): FixIssue[];
}

/**
 * Create a {@link FixEngine} bound to a dictionary. Accepts either a {@link Dictionary}
 * runtime index or a raw {@link DictionaryJSON} (which is loaded for you). The returned
 * engine is pure and reusable across messages.
 *
 * @example
 * ```ts
 * import { createFixEngine } from '@boarteam/fix';
 * import { dictionary } from '@boarteam/fix-dict-fix44';
 * const fix = createFixEngine(dictionary);
 * const { message, issues } = fix.parse(raw);
 * ```
 */
export function createFixEngine(
  dictionary: Dictionary | DictionaryJSON,
  options: EngineOptions = {},
): FixEngine {
  const dict = dictionary instanceof Dictionary ? dictionary : loadDictionary(dictionary);
  return {
    dictionary: dict,
    parse: (raw, o) => parse(raw, dict, mergeParse(options, o)),
    parseAll: (raw, o) => parseAll(raw, dict, mergeParse(options, o)),
    encode: (message, o) => encode(message, dict, { ...o, soh: o?.soh ?? options.soh }),
    validate: (message, o) => validate(message, dict, o),
  };
}

// Merge with `??` (not spread) so a per-call option of explicit `undefined` — e.g. from a
// forwarded options bag — does not clobber the engine default.
function mergeParse(defaults: EngineOptions, perCall: ParseOptions | undefined): ParseOptions {
  return {
    soh: perCall?.soh ?? defaults.soh,
    checkFraming: perCall?.checkFraming ?? defaults.checkFraming,
  };
}
