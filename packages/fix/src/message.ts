/**
 * A typed, self-rendering Message object — the ergonomic, statically-typed counterpart to
 * the low-level {@link encode} primitive.
 *
 * Where `encode(EncodeMessage)` takes an untyped, tag-keyed bag (any tag may go anywhere,
 * enum/datatype correctness caught only later by `validate`), a Message is created for a
 * specific `MsgType` and carries a **name-keyed body** whose allowed fields/groups and
 * value types are pinned by the generated per-message body type (see the dict packages'
 * generated `MessageBodies`). It:
 *
 * 1. statically knows that message's settable fields/groups and their value types;
 * 2. renders itself to framed wire by invoking {@link encode} internally —
 *    **byte-identical** to a hand-built `encode` of equivalent content (it forks none of
 *    the ordering/framing/checksum logic);
 * 3. doubles as a typed read model ({@link MessageView.get}/{@link MessageView.has}), so
 *    callers can read fields back for logging/metadata without re-parsing.
 *
 * The runtime is **one generic, dictionary-driven implementation**; the per-message typing
 * is supplied by the caller's body type (generated in the dict package, or `UntypedBody`
 * for the loose path). The library stays transport/session-agnostic: envelope fields
 * (`MsgSeqNum`/`SenderCompID`/`SendingTime`/`TargetCompID`, framing 8/9/10) are supplied to
 * {@link MessageView.render} at call time — a Message holds no sequence counter, clock, or
 * comp-IDs.
 */
import { type EncodeMessage, type EncodeOptions, type FieldValue, encode } from './codec/encode';
import type { GroupEntry } from './codec/encode';
import { Dictionary, loadDictionary } from './dictionary/Dictionary';
import type { DictionaryJSON } from './dictionary/types';

export type { FieldValue } from './codec/encode';

/**
 * The loose body type for the untyped path: any field name maps to any scalar value or, for
 * a group counter name, an array of entry bodies. Used as the default body type of
 * {@link createMessage}/{@link createFixEngine} when no generated `MessageBodies` is
 * supplied, so `engine.create(someMsgType)` still works — without the field-level type
 * safety a concrete body type provides.
 */
export type UntypedBody = Record<string, FieldValue | readonly UntypedBody[]>;

/**
 * The init shape for a message body `B` — what {@link MessageFactory}, {@link createMessage},
 * and the engine's `create` accept. Key modifiers are preserved from `B`: a
 * dictionary-required field must be named (pass `undefined` to deliberately omit it — the
 * escape hatch for dialects that skip a "required" tag), an optional field may be left out
 * entirely. Every value additionally accepts `null | undefined`, and all absent values —
 * `undefined`, `null`, and `''` — are skipped at render and reported absent by
 * {@link MessageView.has}, so possibly-empty values pass straight through without guards:
 *
 * ```ts
 * message(MsgType.Logon, {
 *   EncryptMethod: EncryptMethod.NONE,
 *   HeartBtInt: 30,
 *   Username: username,   // string | null | undefined — no `if (username)` needed
 *   Password: password,
 * });
 * ```
 *
 * Repeating-group entry arrays are widened deep via {@link FieldInit}: entry keys keep their
 * requiredness, entry values accept the same absent forms. `| undefined` is spelled
 * explicitly so the shape stays correct for consumers compiling with
 * `exactOptionalPropertyTypes`.
 */
export type MessageInit<B> = {
  [K in keyof B]: FieldInit<B[K]> | null | undefined;
};

/**
 * A single field/group value in init position: a group-counter value (an array of entry
 * bodies) is accepted as a `readonly` array of {@link MessageInit}-widened entries; scalar
 * values pass through unchanged, so enum unions and dialect casts are preserved. Entries
 * themselves may NOT be `null`/`undefined` — the renderer recurses into each entry object.
 */
export type FieldInit<V> = V extends readonly (infer E extends object)[]
  ? readonly MessageInit<E>[]
  : V;

/**
 * Envelope (header/trailer/session) fields supplied to {@link MessageView.render} at call
 * time — the fields a Message deliberately does NOT model in its typed body: `MsgSeqNum`
 * (34), `SenderCompID` (49), `SendingTime` (52), `TargetCompID` (56), and any other
 * standard-header/trailer field. Keys may be field **names** (`SenderCompID`) or numeric
 * **tags** (`49`); framing tags 8/9/10 and `MsgType` (35) are computed by the encoder and
 * ignored if supplied here. Absent values (`undefined`, `null`, `''`) are skipped, so
 * conditional session fields (`SenderSubID`, …) can be passed straight through.
 */
export interface Envelope {
  /** A header/trailer field addressed by its spec NAME, e.g. `SenderCompID`. */
  readonly [field: string]: FieldValue | null | undefined;
  /** The same field addressed by its numeric TAG, e.g. `49`. */
  readonly [tag: number]: FieldValue | null | undefined;
}

/**
 * The read surface shared by the mutable and immutable Message — enough to drive log
 * metadata (msgType, `Symbol`, `SecurityID`, per-entry prices) and to render to wire.
 */
export interface MessageView<B extends object> {
  /** The `MsgType` (tag 35) value this message was created for. */
  readonly msgType: string;
  /** Read a body field/group by name; `undefined` when unset. Typed to the field's value type. */
  get<K extends keyof B & string>(name: K): B[K] | undefined;
  /** Whether a body field/group is currently renderable (not `undefined`/`null`/`''`). */
  has(name: keyof B & string): boolean;
  /**
   * The tag-keyed {@link EncodeMessage} this body renders to (the escape hatch to the
   * low-level {@link encode} primitive). Framing/envelope fields are not
   * included — they are supplied to {@link render}.
   */
  toEncodeMessage(): EncodeMessage;
  /** A shallow snapshot of the name-keyed body as stored, absent values included (also used by `JSON.stringify`). */
  toJSON(): Partial<MessageInit<B>>;
  /**
   * Render to a complete, framed FIX string. The body is merged with the supplied
   * {@link Envelope} and passed to {@link encode}: fields land in their
   * dictionary-prescribed positions (envelope fields in the header, body fields in the
   * body), so the output is byte-identical to `encode` of equivalent content. On a tag
   * collision the body value wins over the envelope.
   */
  render(envelope?: Envelope, options?: EncodeOptions): string;
}

/**
 * A mutable, fluent Message builder — the fast path for hot loops (per-tick market-data
 * snapshots): {@link set}/{@link assign} mutate in place and return `this` for chaining,
 * then {@link MessageView.render} converts the body once. Bodies are plain objects (no JS
 * accessor properties), so writes are ordinary property assignments.
 */
export interface MutableMessage<B extends object> extends MessageView<B> {
  /** Set one field/group (absent values allowed — see {@link MessageInit}); returns `this` for chaining. */
  set<K extends keyof B & string>(name: K, value: FieldInit<B[K]> | null | undefined): this;
  /** Set many fields/groups at once from a partial init object; returns `this`. */
  assign(fields: Partial<MessageInit<B>>): this;
  /** Unset a field/group; returns `this`. */
  delete(name: keyof B & string): this;
  /** A snapshot copy as an {@link ImmutableMessage} (the mutable original is unaffected). */
  toImmutable(): ImmutableMessage<B>;
}

/**
 * An immutable Message — every edit returns a NEW instance (copy-on-write of the top-level
 * body), leaving the original untouched. Preferred when a message is shared, cached, or
 * treated as a value; use {@link MutableMessage} for the hot path. Copy-on-write is shallow:
 * to change a repeating group, pass a fresh array to {@link with}/{@link merge}.
 */
export interface ImmutableMessage<B extends object> extends MessageView<B> {
  /** A new message with one field/group set (absent values allowed — see {@link MessageInit}). */
  with<K extends keyof B & string>(
    name: K,
    value: FieldInit<B[K]> | null | undefined,
  ): ImmutableMessage<B>;
  /** A new message with many fields/groups set from a partial init object. */
  merge(fields: Partial<MessageInit<B>>): ImmutableMessage<B>;
  /** A new message with a field/group unset. */
  without(name: keyof B & string): ImmutableMessage<B>;
  /** A snapshot copy as a {@link MutableMessage}. */
  toMutable(): MutableMessage<B>;
}

/**
 * A dictionary-bound, typed message factory — the strongly-typed entry point the dict
 * packages re-export (`message`). Call it with a `MsgType` value keyed into `Bodies` (e.g.
 * `MsgType.MarketDataSnapshotFullRefresh`, the literal `"W"`) to get a builder typed to
 * exactly that message's body. Build one with {@link messageFactory}.
 */
export interface MessageFactory<Bodies> {
  /**
   * Create a mutable message for `msgType`, optionally seeded with a complete `init` (see
   * {@link MessageInit}: required keys must be named, `undefined` deliberately omits; omit
   * `init` entirely to build incrementally).
   */
  <M extends keyof Bodies & string>(
    msgType: M,
    init?: MessageInit<Bodies[M] & object>,
  ): MutableMessage<Bodies[M] & object>;
  /** Create an immutable message for `msgType`, optionally seeded with a complete `init`. */
  immutable<M extends keyof Bodies & string>(
    msgType: M,
    init?: MessageInit<Bodies[M] & object>,
  ): ImmutableMessage<Bodies[M] & object>;
}

// --- implementation ----------------------------------------------------------------------

/**
 * Shared state and read logic for both message flavours. Holds the runtime dictionary, the
 * fixed `msgType`, and the name-keyed body object (which IS the typed read model).
 *
 * Exported for the inbound read view in `inbound.ts` to extend; NOT part of the public API
 * (it is deliberately absent from `index.ts`).
 * @internal
 */
export abstract class MessageBase<B extends object> implements MessageView<B> {
  protected readonly dict: Dictionary;
  readonly msgType: string;
  /** The name-keyed body: field name → scalar value, or group counter name → entry bodies. */
  protected body: Record<string, unknown>;

  constructor(dict: Dictionary, msgType: string, body: Record<string, unknown>) {
    this.dict = dict;
    this.msgType = msgType;
    this.body = body;
  }

  get<K extends keyof B & string>(name: K): B[K] | undefined {
    // A stored `null` (legal in MessageInit) reads back as `undefined`, keeping the declared
    // `B[K] | undefined` return type truthful.
    return (this.body[name] ?? undefined) as B[K] | undefined;
  }

  has(name: keyof B & string): boolean {
    // Absent ⇔ `undefined`/`null`/`''`, mirroring render (which skips all three).
    const value = this.body[name as string];
    return value != null && value !== '';
  }

  toEncodeMessage(): EncodeMessage {
    const { fields, groups } = bodyToEncode(
      this.body,
      this.dict,
      this.msgType,
      this.#allowedTags(),
    );
    return { msgType: this.msgType, fields, groups };
  }

  toJSON(): Partial<MessageInit<B>> {
    return { ...(this.body as Partial<MessageInit<B>>) };
  }

  render(envelope: Envelope = {}, options?: EncodeOptions): string {
    const allowed = this.#allowedTags();
    const { fields, groups } = bodyToEncode(this.body, this.dict, this.msgType, allowed);
    const envFields = toTagFields(envelope, this.dict, this.msgType, allowed);
    // Envelope first so body fields win on a tag collision; encode places each in its
    // dictionary-prescribed position regardless of this merge order.
    return encode(
      { msgType: this.msgType, fields: { ...envFields, ...fields }, groups },
      this.dict,
      options,
    );
  }

  /**
   * The tags that may legitimately appear in this message (body + header/trailer + all group
   * members), used to reject a field the caller set that is valid in the dictionary but not in
   * THIS message. `undefined` when the msgType is unknown — then validation is deferred to
   * `encode`, which throws its own `unknown MsgType` error.
   */
  #allowedTags(): ReadonlySet<number> | undefined {
    return this.dict.messageByMsgType(this.msgType)
      ? this.dict.allowedTags(this.msgType)
      : undefined;
  }
}

class MutableMessageImpl<B extends object> extends MessageBase<B> implements MutableMessage<B> {
  set<K extends keyof B & string>(name: K, value: FieldInit<B[K]> | null | undefined): this {
    this.body[name] = value;
    return this;
  }

  assign(fields: Partial<MessageInit<B>>): this {
    Object.assign(this.body, fields);
    return this;
  }

  delete(name: keyof B & string): this {
    delete this.body[name as string];
    return this;
  }

  toImmutable(): ImmutableMessage<B> {
    return new ImmutableMessageImpl<B>(this.dict, this.msgType, { ...this.body });
  }
}

class ImmutableMessageImpl<B extends object> extends MessageBase<B> implements ImmutableMessage<B> {
  with<K extends keyof B & string>(
    name: K,
    value: FieldInit<B[K]> | null | undefined,
  ): ImmutableMessage<B> {
    return new ImmutableMessageImpl<B>(this.dict, this.msgType, { ...this.body, [name]: value });
  }

  merge(fields: Partial<MessageInit<B>>): ImmutableMessage<B> {
    return new ImmutableMessageImpl<B>(this.dict, this.msgType, { ...this.body, ...fields });
  }

  without(name: keyof B & string): ImmutableMessage<B> {
    const next = { ...this.body };
    delete next[name as string];
    return new ImmutableMessageImpl<B>(this.dict, this.msgType, next);
  }

  toMutable(): MutableMessage<B> {
    return new MutableMessageImpl<B>(this.dict, this.msgType, { ...this.body });
  }
}

/**
 * Convert a name-keyed body into the tag-keyed {@link EncodeMessage} `fields`/`groups` the
 * encoder consumes. Purely dictionary-driven: each body property is resolved by field name;
 * a group-counter name carries an array of entry bodies (recursively converted), everything
 * else is a scalar. Fails loud rather than silently dropping or corrupting data — it throws on
 * a name the dictionary does not know, a non-scalar value on a scalar field, a non-array on a
 * group counter, and (when {@link allowed} is supplied) a field valid in the dictionary but not
 * part of this message. The last check closes the gap where a mis-placed field would resolve to
 * a real tag yet be silently omitted by `encode` (which emits only this message's members).
 */
function bodyToEncode(
  body: Record<string, unknown>,
  dict: Dictionary,
  msgType: string,
  allowed: ReadonlySet<number> | undefined,
): { fields: Record<number, FieldValue>; groups: Record<number, GroupEntry[]> } {
  const fields: Record<number, FieldValue> = {};
  const groups: Record<number, GroupEntry[]> = {};
  for (const name of Object.keys(body)) {
    const value = body[name];
    // Skip `undefined`, `null`, and `''` — the three absent forms (see MessageInit). The
    // encoder omits only `undefined`; a `null` left in the body would otherwise reach the
    // wire as the literal text `tag=null`, and `''` as a malformed empty `tag=` value. A
    // caller who truly needs an empty value on the wire can drop to the `encode` primitive.
    if (value === undefined || value === null || value === '') {
      continue;
    }
    const field = dict.fieldByName(name);
    if (!field) {
      throw new Error(`message: field name "${name}" is not defined in dictionary ${dict.version}`);
    }
    if (allowed && !allowed.has(field.tag)) {
      throw new Error(
        `message: field "${name}" (${field.tag}) is not part of message "${msgType}"; encode would silently drop it`,
      );
    }
    if (dict.isGroupCounter(field.tag)) {
      if (!Array.isArray(value)) {
        throw new Error(
          `message: group "${name}" (${field.tag}) expects an array of entries, got ${typeof value}`,
        );
      }
      groups[field.tag] = value.map((entry) => {
        const sub = bodyToEncode(entry as Record<string, unknown>, dict, msgType, allowed);
        return { fields: sub.fields, groups: sub.groups };
      });
    } else if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      fields[field.tag] = value;
    } else {
      throw new Error(
        `message: field "${name}" (${field.tag}) expects a string/number/boolean, got ${typeof value}`,
      );
    }
  }
  return { fields, groups };
}

/**
 * Convert an {@link Envelope} to tag-keyed fields for the encoder. A numeric-string key is
 * taken as a tag; any other key is resolved by field name. Both forms are validated the same
 * way: the tag must be known to the dictionary and (when {@link allowed} is supplied) part of
 * this message — so a session field is never silently dropped, whether addressed by name or tag.
 */
function toTagFields(
  envelope: Envelope,
  dict: Dictionary,
  msgType: string,
  allowed: ReadonlySet<number> | undefined,
): Record<number, FieldValue> {
  const out: Record<number, FieldValue> = {};
  for (const key of Object.keys(envelope)) {
    const value = envelope[key];
    // Same absence rule as the body: `undefined`/`null`/`''` are skipped.
    if (value === undefined || value === null || value === '') {
      continue;
    }
    const tag = /^\d+$/.test(key) ? Number(key) : dict.fieldByName(key)?.tag;
    if (tag === undefined || !dict.fieldByTag(tag)) {
      throw new Error(
        `message: envelope field "${key}" is not defined in dictionary ${dict.version}`,
      );
    }
    if (allowed && !allowed.has(tag)) {
      throw new Error(
        `message: envelope field "${key}" (${tag}) is not part of message "${msgType}"; encode would silently drop it`,
      );
    }
    out[tag] = value;
  }
  return out;
}

function resolveDict(dict: Dictionary | DictionaryJSON): Dictionary {
  return dict instanceof Dictionary ? dict : loadDictionary(dict);
}

/**
 * Create a {@link MutableMessage} for a `MsgType`, optionally seeded with a complete
 * {@link MessageInit} (omit it to build incrementally). The body type `B` defaults to the
 * loose {@link UntypedBody}; pass a generated per-message body type (or use the dict
 * package's typed `message` factory / a `createFixEngine<Bodies>` engine) for field-level
 * type safety.
 * @param msgType The `MsgType` (tag 35) value the message is created for.
 * @param dict The dictionary that defines the message and renders it.
 * @param init Optional complete body init (see {@link MessageInit}); omit to build incrementally.
 * @returns A mutable, fluent builder typed to `B`.
 */
export function createMessage<B extends object = UntypedBody>(
  msgType: string,
  dict: Dictionary | DictionaryJSON,
  init?: MessageInit<B>,
): MutableMessage<B> {
  return new MutableMessageImpl<B>(resolveDict(dict), msgType, init ? { ...init } : {});
}

/**
 * Create an {@link ImmutableMessage} for a `MsgType`. See {@link createMessage}.
 *
 * @param msgType The `MsgType` (tag 35) value the message is created for.
 * @param dict The dictionary that defines the message and renders it.
 * @param init Optional complete body init (see {@link MessageInit}); omit to build incrementally.
 * @returns An immutable message; every edit returns a new instance.
 */
export function createImmutableMessage<B extends object = UntypedBody>(
  msgType: string,
  dict: Dictionary | DictionaryJSON,
  init?: MessageInit<B>,
): ImmutableMessage<B> {
  return new ImmutableMessageImpl<B>(resolveDict(dict), msgType, init ? { ...init } : {});
}

/**
 * Build a dictionary-bound {@link MessageFactory} typed by a `Bodies` registry (the
 * generated `MessageBodies` map of `MsgType` value → body type). The dict packages call
 * this and re-export the result as `message`:
 *
 * ```ts
 * export const message = messageFactory<MessageBodies>(dictionary);
 * message('W').set('MDReqID', 'r1');        // typed to MarketDataSnapshotFullRefresh
 * message.immutable(MsgType.Logon).with(...);
 * ```
 * @param dict The dictionary every created message is bound to.
 * @returns The typed factory the dict packages re-export as `message`.
 */
export function messageFactory<Bodies>(dict: Dictionary | DictionaryJSON): MessageFactory<Bodies> {
  const d = resolveDict(dict);
  function factory<M extends keyof Bodies & string>(
    msgType: M,
    init?: MessageInit<Bodies[M] & object>,
  ): MutableMessage<Bodies[M] & object> {
    return new MutableMessageImpl<Bodies[M] & object>(d, msgType, init ? { ...init } : {});
  }
  factory.immutable = <M extends keyof Bodies & string>(
    msgType: M,
    init?: MessageInit<Bodies[M] & object>,
  ): ImmutableMessage<Bodies[M] & object> =>
    new ImmutableMessageImpl<Bodies[M] & object>(d, msgType, init ? { ...init } : {});
  return factory;
}

/**
 * A `Bodies`-bound message-narrowing type guard — the read-side counterpart of
 * {@link MessageFactory}. Given a message of unknown body (a `MessageView<any>`, e.g. at a
 * generic `send(message)` boundary where the concrete msgType is erased) and a `MsgType` value
 * keyed into `Bodies`, it narrows the message to that message's body so subsequent
 * {@link MessageView.get}/{@link MessageView.has} reads are typed — no `any`, no casts. The
 * runtime is a plain `msgType` string compare; the narrowing comes entirely from `Bodies[M]`.
 *
 * It narrows to the read surface {@link MessageView} (the interface both {@link MutableMessage}
 * and {@link ImmutableMessage} extend), not to the mutable/immutable *kind*: the guard's job is
 * typed reads at an inbound/outbound boundary, and a call site that already holds a concrete
 * builder rarely needs to re-narrow it. Preserving the kind would take a second overload keyed
 * on the input type for no read-side benefit. Build one with {@link messageTypeGuard}.
 */
export type MessageTypeGuard<Bodies> = <M extends keyof Bodies & string>(
  // The body is unknown at this boundary, so `any` keeps `get()`/`has()` callable on the input;
  // the true-branch type comes from the `Bodies[M]` narrowing target, not from this parameter.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  message: MessageView<any>,
  msgType: M,
) => message is MessageView<Bodies[M] & object>;

/**
 * The read surface of the message whose `MsgType` value is `M` in a `Bodies` registry — a
 * convenience alias for annotating a narrowed message (a function parameter, a variable). Equal
 * to `MessageView<Bodies[M] & object>`; the dict packages emit a pre-bound one-argument
 * `MessageOf<M>` over their generated `MessageBodies`.
 */
export type MessageOf<Bodies, M extends keyof Bodies & string> = MessageView<Bodies[M] & object>;

/**
 * Build a dictionary-agnostic {@link MessageTypeGuard} bound to a `Bodies` registry (the
 * generated `MessageBodies` map of `MsgType` value → body type). The dict packages call this and
 * re-export the result as `isMessageType`:
 *
 * ```ts
 * const isMessageType = messageTypeGuard<MessageBodies>();
 * if (isMessageType(message, 'W')) {
 *   message.get('SecurityID');      // string | undefined — typed to MarketDataSnapshotFullRefresh
 *   message.get('NoMDEntries');     // the typed entry array
 * }
 * ```
 *
 * Pure and side-effect-free: the only runtime work is `message.msgType === msgType`, so it holds
 * no dictionary, session, or transport state.
 * @returns The narrowing guard; its runtime is a plain `msgType` compare.
 */
export function messageTypeGuard<Bodies>(): MessageTypeGuard<Bodies> {
  return <M extends keyof Bodies & string>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    message: MessageView<any>,
    msgType: M,
  ): message is MessageView<Bodies[M] & object> => message.msgType === msgType;
}
