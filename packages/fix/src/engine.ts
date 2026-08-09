import { type EncodeMessage, type EncodeOptions, encode } from './codec/encode';
import {
  type ParseOptions,
  type ParseResult,
  type ParsedMessage,
  parse,
  parseAll,
} from './codec/parse';
import { Dictionary, loadDictionary } from './dictionary/Dictionary';
import { type FixtDictionaries, isFixtDictionaries, resolveFixt } from './dictionary/fixt';
import type { DictionaryJSON } from './dictionary/types';
import type { FixIssue } from './errors';
import {
  type ImmutableMessage,
  type MessageInit,
  type MessageTypeGuard,
  type MutableMessage,
  type UntypedBody,
  createImmutableMessage,
  createMessage,
  messageTypeGuard,
} from './message';
import { type ValidateOptions, validate } from './validate/validate';

/** Defaults applied to every call, overridable per call. */
export interface EngineOptions {
  /** Field separator for parse/encode. Defaults to `SOH`. */
  soh?: string;
  /** Verify the transport frame on parse (see {@link ParseOptions.checkFraming}). */
  checkFraming?: boolean;
}

/**
 * A dictionary-bound façade over the stateless codec: `parse`/`parseAll`/`encode`/`create`
 * with the dictionary and default options already applied. Holds no session state (sequence
 * numbers, timestamps, comp-IDs) — it is a thin, pure convenience over the free functions,
 * which remain available for callers who prefer to pass the dictionary explicitly.
 *
 * The optional `Bodies` type parameter is the generated `MessageBodies` map (`MsgType`
 * value → typed body) a dict package ships: `createFixEngine<MessageBodies>(dictionary)`
 * makes {@link FixEngine.create} strongly typed per message. Omit it for the loose,
 * name-keyed {@link UntypedBody} path.
 */
export interface FixEngine<Bodies = Record<string, UntypedBody>> {
  /**
   * The runtime dictionary this engine is bound to. For an engine created with a FIXT
   * transport/application pair this is the pair's *merged* view (the dictionary messages
   * are structurally parsed and encoded against); the layers stay reachable via
   * {@link transport} and {@link app}.
   */
  readonly dictionary: Dictionary;
  /** The FIXT transport dictionary, when the engine was created with a pair. */
  readonly transport?: Dictionary;
  /** The (default) application dictionary, when the engine was created with a pair. */
  readonly app?: Dictionary;
  /** Parse the first message in the input. See {@link parse}. */
  parse(raw: string | Uint8Array, options?: ParseOptions): ParseResult;
  /** Parse every message in a concatenated buffer. See {@link parseAll}. */
  parseAll(raw: string | Uint8Array, options?: ParseOptions): ParseResult[];
  /** Encode a message into a framed FIX string. See {@link encode}. */
  encode(message: EncodeMessage, options?: EncodeOptions): string;
  /** Validate a parsed message against the dictionary. See {@link validate}. */
  validate(message: ParsedMessage, options?: ValidateOptions): FixIssue[];
  /**
   * Create a typed, self-rendering {@link MutableMessage} for a `MsgType`. See
   * {@link createMessage}. Typed to `Bodies[M]` when the engine was created with a
   * `MessageBodies` type parameter.
   */
  create<M extends keyof Bodies & string>(
    msgType: M,
    init?: MessageInit<Bodies[M] & object>,
  ): MutableMessage<Bodies[M] & object>;
  /** Create a typed {@link ImmutableMessage} for a `MsgType`. See {@link createImmutableMessage}. */
  createImmutable<M extends keyof Bodies & string>(
    msgType: M,
    init?: MessageInit<Bodies[M] & object>,
  ): ImmutableMessage<Bodies[M] & object>;
  /**
   * Narrow a message of unknown body to a specific message's read surface, keyed on its
   * `MsgType` value — the read-side counterpart of {@link FixEngine.create}, with `Bodies`
   * already bound. Inside `if (engine.is(msg, 'W')) { … }`, `msg.get(…)` is typed to that
   * message's body. Runtime is a plain `msgType` compare. See {@link messageTypeGuard}.
   */
  is: MessageTypeGuard<Bodies>;
}

/**
 * Create a {@link FixEngine} bound to a dictionary. Accepts a {@link Dictionary} runtime
 * index, a raw {@link DictionaryJSON} (which is loaded for you), or a FIXT
 * transport/application pair ({@link FixtDictionaries}) — the FIXT form parses/encodes over
 * the pair's merged view and returns layer-attributed diagnostics from
 * {@link FixEngine.validate} (see {@link FixIssue.layer}). The returned engine is pure and
 * reusable across messages.
 *
 * The `// →` annotations below are asserted outputs, not aspirations: every `@example`
 * block is executed against the built packages by the doctest gate
 * (examples/api-doctest.test.ts), which fails when a block does not run or does not
 * print what it claims.
 *
 * @param dictionary A {@link Dictionary} index, a raw {@link DictionaryJSON}, or a FIXT transport/application pair.
 * @param options Per-engine defaults ({@link EngineOptions}), overridable on each call.
 * @returns A pure, reusable engine bound to the dictionary.
 *
 * @example
 * ```ts
 * import { createFixEngine } from '@boarteam/fix';
 * import { dictionary } from '@boarteam/fix-dict-fix44';
 *
 * const fix = createFixEngine(dictionary);
 * const raw = '8=FIX.4.4|9=58|35=A|49=BUY|56=SELL|34=1|52=20260807-12:00:00|98=0|108=30|10=164|';
 * const { message, issues } = fix.parse(raw, { soh: '|' });
 * console.log(message.name, issues.length); // → Logon 0
 * ```
 *
 * @example FIXT.1.1 pair (layer-attributed validation)
 * ```ts
 * import { createFixEngine } from '@boarteam/fix';
 * import { dictionary as fixt11 } from '@boarteam/fix-dict-fixt11';
 * import { dictionary as fix50sp2 } from '@boarteam/fix-dict-fix50sp2';
 *
 * const fix = createFixEngine({ transport: fixt11, app: fix50sp2 });
 * // A FIXT Logon missing its required EncryptMethod(98) — a session-layer defect,
 * // so the finding says: answer with a session Reject(3), not a BusinessMessageReject.
 * const raw = '8=FIXT.1.1|9=60|35=A|49=BUY|56=SELL|34=1|52=20260807-12:00:00|108=30|1137=9|10=079|';
 * const issues = fix.validate(fix.parse(raw, { soh: '|' }).message);
 * const sessionFindings = issues.filter((i) => i.layer === 'session');
 * console.log(sessionFindings.map((i) => `${i.code}(${i.refTagID})`)); // → [ 'validate/required-field-missing(98)' ]
 * ```
 */
export function createFixEngine<Bodies = Record<string, UntypedBody>>(
  dictionary: Dictionary | DictionaryJSON | FixtDictionaries,
  options: EngineOptions = {},
): FixEngine<Bodies> {
  if (isFixtDictionaries(dictionary)) {
    const resolved = resolveFixt(dictionary);
    return {
      dictionary: resolved.merged,
      transport: resolved.transport,
      app: resolved.app,
      // parse/validate/encode take the PAIR (not the resolved merge) so per-message
      // ApplVerID(1128) routing through a resolveApp hook stays live per call.
      parse: (raw, o) => parse(raw, dictionary, mergeParse(options, o)),
      parseAll: (raw, o) => parseAll(raw, dictionary, mergeParse(options, o)),
      encode: (message, o) => encode(message, dictionary, { ...o, soh: o?.soh ?? options.soh }),
      validate: (message, o) => validate(message, dictionary, o),
      // Typed builders bind to the merged view: both session and application bodies are
      // constructible (pass the merged dict package's MessageBodies as `Bodies`).
      create: (msgType, init) =>
        createMessage<Bodies[typeof msgType] & object>(msgType, resolved.merged, init),
      createImmutable: (msgType, init) =>
        createImmutableMessage<Bodies[typeof msgType] & object>(msgType, resolved.merged, init),
      is: messageTypeGuard<Bodies>(),
    };
  }
  const dict = dictionary instanceof Dictionary ? dictionary : loadDictionary(dictionary);
  return {
    dictionary: dict,
    parse: (raw, o) => parse(raw, dict, mergeParse(options, o)),
    parseAll: (raw, o) => parseAll(raw, dict, mergeParse(options, o)),
    encode: (message, o) => encode(message, dict, { ...o, soh: o?.soh ?? options.soh }),
    validate: (message, o) => validate(message, dict, o),
    create: (msgType, init) => createMessage<Bodies[typeof msgType] & object>(msgType, dict, init),
    createImmutable: (msgType, init) =>
      createImmutableMessage<Bodies[typeof msgType] & object>(msgType, dict, init),
    is: messageTypeGuard<Bodies>(),
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
