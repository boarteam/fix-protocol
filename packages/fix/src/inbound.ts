/**
 * The **read-side counterpart of the typed Message API** — what `parse` gives you, seen
 * through the same name-keyed, per-message types the builder already uses.
 *
 * {@link parse} returns a {@link ParsedMessage}: tag-keyed, faithful to the wire, and
 * deliberately untyped (`msgType` is a `string`, fields are `Record<number, ParsedField>`).
 * That is the right shape for a codec, and the wrong shape for application code, which
 * ends up hand-writing a `switch (msgType)` and a tag→field mapper per message — exactly
 * the code the generated `MessageBodies` types already describe.
 *
 * {@link toInbound} closes that gap. It converts a `ParsedMessage` into an
 * {@link InboundMessage}: a {@link MessageView} whose body is name-keyed
 * (`NoMDEntries` is an array of entry objects, not `groups[268]`), so
 * {@link inboundTypeGuard} narrows it to a concrete generated body and `get()` reads are
 * typed — the mirror image of `message(MsgType.X, …)` on the way out.
 *
 * Two things it does NOT do, both on purpose:
 *
 * - **It does not re-parse or re-validate.** It is a pure re-keying of what `parse`
 *   produced; every diagnostic was already reported there, and {@link validate} still runs
 *   against the `ParsedMessage`.
 * - **It is not the byte-faithful re-encode path.** {@link ParsedField.raw} is the source
 *   of truth for round-tripping, and a body carries the coerced {@link ParsedField.value}.
 *   To re-emit received bytes, use `toEncodeMessage(parsed)`, which the view keeps reachable
 *   through {@link InboundMessage.parsed}.
 */
import type { DecodedValue } from './codec/datatypes';
import type { ParsedField, ParsedGroupEntry, ParsedMessage } from './codec/parse';
import { Dictionary, loadDictionary } from './dictionary/Dictionary';
import type { DictionaryJSON } from './dictionary/types';
import { MessageBase, type MessageView } from './message';

/**
 * The loose body shape of a received message — the read-side counterpart of
 * {@link UntypedBody}. A repeating-group entry has the same shape, so it is also what an
 * untyped entry array holds.
 *
 * It is NOT `UntypedBody`: that type describes what a caller may *write*
 * ({@link FieldValue} — `string | number | boolean`, never absent), whereas a value read
 * off the wire is a {@link DecodedValue} (adding `string[]` for `MultipleValueString`) and
 * an optional field is genuinely absent.
 *
 * It is also **not** the default body of {@link toInbound}, which is `any` — pass this
 * explicitly (`toInbound<InboundBody>(…)`) when you mean to read a message whose type you
 * will not narrow. The default cannot be this type, or any other loose one: a generated
 * body is an `interface`, and TypeScript never gives an interface an implicit index
 * signature, so no index-signature type is ever its supertype. A narrowing predicate whose
 * target is not assignable to the declared type yields an INTERSECTION rather than a
 * replacement, and the loose `get` overload would then win at every call site — silently
 * undoing the narrowing. `any` is what keeps {@link inboundTypeGuard} an actual narrowing,
 * and it is the same choice {@link MessageTypeGuard} makes on the write side.
 */
export interface InboundBody {
  /** A field by name, or a repeating group by its counter's name. */
  readonly [name: string]: DecodedValue | readonly InboundBody[] | undefined;
}

/**
 * The session envelope of a received message — the standard header and trailer fields,
 * keyed by name and carrying their coerced values.
 *
 * This is the half of a message the generated `MessageBodies` types deliberately exclude:
 * on the way out those fields belong to the session layer and are supplied to
 * {@link MessageView.render}, so a body type never mentions them. On the way IN they are
 * simply present in the bytes, and reading `MsgSeqNum` off a received message is the most
 * ordinary thing a session does — hence a typed home for them here rather than a detour
 * back through the tag-keyed {@link ParsedMessage}.
 *
 * Which fields land here is decided by the dictionary's header/trailer components (see
 * {@link Dictionary.envelopeTags}), not by this list: the named properties below are the
 * ones stable across FIX 4.x and FIXT, typed for convenience, and the index signature
 * carries everything else the dictionary's header defines (`OnBehalfOfCompID`, `NoHops`
 * entries' fields, `ApplVerID`, …).
 */
export interface InboundEnvelope {
  /** `BeginString` (8) — the dialect the frame declared. */
  readonly BeginString?: string;
  /** `BodyLength` (9), as declared on the wire. */
  readonly BodyLength?: number;
  /** `MsgType` (35). Also available unconditionally as {@link MessageView.msgType}. */
  readonly MsgType?: string;
  /** `MsgSeqNum` (34) — the sequence number this message arrived with. */
  readonly MsgSeqNum?: number;
  /** `SenderCompID` (49) — the counterparty that sent it. */
  readonly SenderCompID?: string;
  /** `TargetCompID` (56) — us, on a well-addressed message. */
  readonly TargetCompID?: string;
  /** `SenderSubID` (50). */
  readonly SenderSubID?: string;
  /** `TargetSubID` (57). */
  readonly TargetSubID?: string;
  /** `SendingTime` (52), verbatim (`YYYYMMDD-HH:MM:SS[.sss]`) — never coerced to a `Date`. */
  readonly SendingTime?: string;
  /** `OrigSendingTime` (122) on a resend, verbatim. */
  readonly OrigSendingTime?: string;
  /**
   * `PossDupFlag` (43) — set when the counterparty flagged a possible duplicate.
   *
   * `boolean | string` because the answer depends on the dictionary, not on this field:
   * an enumerated value is decoded **opaquely** (kept as `'Y'`/`'N'`) so leading-zero and
   * multi-character codes survive, and the standard dictionaries do enumerate tag 43. A
   * dictionary that types it as a bare `Boolean` yields `true`/`false`. Compare against
   * both, or read {@link ParsedField.raw} off {@link InboundMessage.parsed}.
   */
  readonly PossDupFlag?: boolean | string;
  /** `PossResend` (97). Enumerated like {@link PossDupFlag} — see the note there. */
  readonly PossResend?: boolean | string;
  /** `CheckSum` (10), verbatim — three digits, leading zeros intact. */
  readonly CheckSum?: string;
  /**
   * Any other header/trailer field the dictionary defines, by name — including a group the
   * header itself declares (FIX 4.4's `NoHops`), whose entries read the same way as a
   * body group's.
   */
  readonly [name: string]: DecodedValue | readonly InboundBody[] | undefined;
}

/**
 * A received message as a typed read model: the {@link MessageView} read surface over a
 * name-keyed body, plus the session {@link envelope} and the {@link parsed} original.
 *
 * The body carries the message's own fields keyed by name, with the envelope split off
 * into {@link envelope} and group counters keyed to arrays of entry objects — the shape a
 * generated `<Msg>Body` type describes, so {@link inboundTypeGuard} can narrow an
 * unnarrowed inbound message to `InboundMessage<MarketDataSnapshotFullRefreshBody>` and
 * every `get()` after it is typed. It holds what the wire actually carried: an optional
 * field that did not arrive is absent, and a field that does not belong to this message
 * (which `parse` reports as `parse/tag-not-in-message`) is present but untyped.
 *
 * Being a `MessageView` it also renders: `inbound.render(envelope)` re-emits the body with
 * a fresh envelope, which is the useful shape for a proxy that re-signs what it forwards.
 * For a byte-exact echo of what arrived, go through `toEncodeMessage(inbound.parsed)`
 * instead — see the module note on `raw` vs `value`.
 */
export interface InboundMessage<B extends object> extends MessageView<B> {
  /** The standard header/trailer fields, by name. See {@link InboundEnvelope}. */
  readonly envelope: InboundEnvelope;
  /**
   * The {@link ParsedMessage} this view was built from — the tag-keyed original, still the
   * source of truth for re-encoding and the only place a tag unknown to the dictionary
   * survives (such a tag has no name to key a body by, and `parse` already reported it as
   * `parse/unknown-tag`).
   */
  readonly parsed: ParsedMessage;
}

/**
 * An {@link InboundMessage} whose `MsgType` is pinned to the literal `M` rather than a bare
 * `string` — the member shape of {@link InboundUnion}, and what a narrowing guard produces.
 *
 * The pin is what makes `msgType` usable as a **discriminant**: `switch` narrows a union by
 * a literal-typed property, and `InboundMessage` alone declares `msgType: string`, which
 * discriminates nothing. Pinning also means a narrowed message reports the truth — after a
 * guard for `'W'`, `msgType` really is `'W'`, not `string`.
 */
export interface InboundMessageOf<B extends object, M extends string> extends InboundMessage<B> {
  /** The `MsgType` (tag 35) value, as a literal type. */
  readonly msgType: M;
}

class InboundMessageImpl<B extends object> extends MessageBase<B> implements InboundMessage<B> {
  readonly envelope: InboundEnvelope;
  readonly parsed: ParsedMessage;

  constructor(
    dict: Dictionary,
    parsed: ParsedMessage,
    body: Record<string, unknown>,
    envelope: InboundEnvelope,
  ) {
    super(dict, parsed.msgType, body);
    this.parsed = parsed;
    this.envelope = envelope;
  }
}

/**
 * Convert a {@link ParsedMessage} into a typed, name-keyed {@link InboundMessage}.
 *
 * Purely dictionary-driven and total — it never throws and never re-reads the wire. Each
 * top-level field is resolved to its dictionary name and routed by
 * {@link Dictionary.envelopeTags}: header/trailer tags to the envelope, everything else to
 * the body. Repeating groups become arrays of entry objects under their counter's name,
 * recursively, so a nested group inside an entry reads the same way as one at the top.
 *
 * **A tag the dictionary does not know is not put in the body.** It has no name to key by,
 * and inventing one (`"9999"`) would make the body un-renderable. It stays reachable on
 * {@link InboundMessage.parsed}, and `parse` has already reported it as `parse/unknown-tag`.
 *
 * The body type `B` is a claim about the message, not a check: pass a generated body type
 * when the `MsgType` is known at the call site, or leave the default and narrow with a
 * guard from {@link inboundTypeGuard} (see {@link InboundBody} for why the default is
 * `any`). Nothing here validates the claim —
 * that is {@link validate}'s job, against the `ParsedMessage`.
 *
 * @param parsed The structured message from {@link parse}.
 * @param dict The dictionary it was parsed against (a {@link DictionaryJSON} is loaded for you).
 * @returns A read-only, typed view over the same message.
 *
 * @example
 * ```ts
 * import { inboundTypeGuard, loadDictionary, parse, toInbound } from '@boarteam/fix';
 * import { dictionary as fix44 } from '@boarteam/fix-dict-fix44';
 *
 * const dictionary = loadDictionary(fix44);
 * const isInboundType = inboundTypeGuard();
 * const raw =
 *   '8=FIX.4.4|9=100|35=W|49=VENUE|56=ME|34=3|52=20260817-09:30:01|262=req-1|55=EURUSD|268=1|269=0|270=1.101|271=1000000|10=192|';
 *
 * const { message } = parse(raw, dictionary, { soh: '|' });
 * const inbound = toInbound(message, dictionary);
 * if (isInboundType(inbound, 'W')) {
 *   // Body fields by name, groups as entry arrays, envelope on the side.
 *   console.log(inbound.get('Symbol'), inbound.get('NoMDEntries').length, inbound.envelope.MsgSeqNum);
 *   // → EURUSD 1 3
 * }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toInbound<B extends object = any>(
  parsed: ParsedMessage,
  dict: Dictionary | DictionaryJSON,
): InboundMessage<B> {
  const d = dict instanceof Dictionary ? dict : loadDictionary(dict);
  const envelopeTags = d.envelopeTags();
  const body: Record<string, unknown> = {};
  const envelope: Record<string, unknown> = {};

  for (const field of Object.values(parsed.fields)) {
    const name = fieldName(field, d);
    if (name === undefined) {
      continue;
    }
    if (envelopeTags.has(field.tag)) {
      envelope[name] = field.value;
    } else {
      // A group counter only lands here on the flat path (an unknown `MsgType`, where no
      // group was reconstructed); its count is then an ordinary scalar, which is the
      // truthful reading of a message the dictionary cannot structure.
      body[name] = field.value;
    }
  }

  for (const [counter, entries] of Object.entries(parsed.groups)) {
    const tag = Number(counter);
    const name = d.fieldByTag(tag)?.name;
    if (name === undefined) {
      continue;
    }
    // A group the HEADER declares (FIX 4.4's `NoHops`) is envelope, not body — the
    // generated body types exclude it for the same reason, so leaving it in the body
    // would put a field there that no `<Msg>Body` declares.
    const target = envelopeTags.has(tag) ? envelope : body;
    target[name] = entries.map((entry) => entryBody(entry, d));
  }

  return new InboundMessageImpl<B>(d, parsed, body, envelope as InboundEnvelope);
}

/** One group entry as a name-keyed body, nested groups included. */
function entryBody(entry: ParsedGroupEntry, dict: Dictionary): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const field of Object.values(entry.fields)) {
    const name = fieldName(field, dict);
    if (name !== undefined) {
      body[name] = field.value;
    }
  }
  for (const [counter, entries] of Object.entries(entry.groups)) {
    const name = dict.fieldByTag(Number(counter))?.name;
    if (name !== undefined) {
      body[name] = entries.map((nested) => entryBody(nested, dict));
    }
  }
  return body;
}

/**
 * The name to key a parsed field by. `parse` already stamps the dictionary name on known
 * tags; the lookup is the fallback for a field carried over from another dictionary view.
 */
function fieldName(field: ParsedField, dict: Dictionary): string | undefined {
  return field.name ?? dict.fieldByTag(field.tag)?.name;
}

/**
 * A `Bodies`-bound narrowing guard for received messages — the inbound counterpart of
 * {@link MessageTypeGuard}, and the reason a `switch (message.msgType)` with a cast per
 * branch is no longer necessary.
 *
 * It narrows to {@link InboundMessage}, not {@link MessageView}, so the
 * {@link InboundMessage.envelope} and {@link InboundMessage.parsed} of the message survive
 * the narrowing — a session almost always wants `MsgSeqNum` alongside the body fields it
 * just gained types for.
 */
export type InboundTypeGuard<Bodies> = <M extends keyof Bodies & string>(
  // The body is unknown at this boundary, so `any` keeps `get()`/`has()` callable on the
  // input; the true-branch type comes from the `Bodies[M]` narrowing target.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  message: InboundMessage<any>,
  msgType: M,
) => message is InboundOf<Bodies, M>;

/**
 * The typed read surface of a received message whose `MsgType` value is `M` in a `Bodies`
 * registry — the inbound counterpart of {@link MessageOf}, for annotating a narrowed
 * message (a handler parameter, a variable).
 */
export type InboundOf<Bodies, M extends keyof Bodies & string> = InboundMessageOf<
  Bodies[M] & object,
  M
>;

/**
 * Build an {@link InboundTypeGuard} bound to a `Bodies` registry (the generated
 * `MessageBodies` map of `MsgType` value → body type). Dict packages re-export the result
 * as `isInboundType`; a consumer can bind one itself from any dict package's exported
 * `MessageBodies`:
 *
 * ```ts
 * import { inboundTypeGuard } from '@boarteam/fix';
 * import type { MessageBodies } from '@boarteam/fix-dict-fix44';
 *
 * const isInboundType = inboundTypeGuard<MessageBodies>();
 * if (isInboundType(inbound, 'W')) {
 *   inbound.get('NoMDEntries');   // the typed entry array
 *   inbound.envelope.MsgSeqNum;   // still reachable after narrowing
 * }
 * ```
 *
 * Pure and side-effect-free: the only runtime work is `message.msgType === msgType`.
 * @returns The narrowing guard; its runtime is a plain `msgType` compare.
 */
export function inboundTypeGuard<Bodies>(): InboundTypeGuard<Bodies> {
  return <M extends keyof Bodies & string>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    message: InboundMessage<any>,
    msgType: M,
  ): message is InboundOf<Bodies, M> => message.msgType === msgType;
}

/**
 * Every message in a `Bodies` registry as ONE discriminated union, keyed on `msgType` —
 * what turns `switch (message.msgType)` into a narrowing dispatch instead of a chain of
 * guards.
 *
 * Each member is an {@link InboundOf}, so `msgType` is a literal in every branch and
 * `get()` inside a `case` is typed to that message's body while {@link
 * InboundMessage.envelope} and {@link InboundMessage.parsed} stay reachable. Handle every
 * member and `default` narrows to `never`, giving compile-time exhaustiveness; handle a
 * subset and `default` stays live and typed — a known message this consumer does not
 * process.
 *
 * ```ts
 * if (isKnownInbound(inbound)) {
 *   switch (inbound.msgType) {
 *     case MsgType.Logon:            return onLogon(inbound);      // LogonBody
 *     case MsgType.MarketDataRequest: return onRequest(inbound);   // MarketDataRequestBody
 *     default:                        return;                      // known, not ours
 *   }
 * }
 * ```
 *
 * Two consequences of being a union, both worth knowing before reaching for it:
 *
 * - **Read the envelope before the switch, the body after.** `msgType` and `envelope` are
 *   the same type in every member, so they read fine unnarrowed; `get()` is a *different*
 *   signature per member, and calling it on the un-narrowed union is a "not callable"
 *   error. That is the right discipline anyway — session fields before dispatch, body
 *   fields inside it.
 * - **An unknown `MsgType` cannot be a member.** A fallback member typed `msgType: string`
 *   overlaps every literal, so no `case` ever eliminates it and its loose `get` poisons
 *   every branch. Exclude unknown messages first, with a guard from
 *   {@link inboundKnownGuard} — which also matches how they parse: an unrecognised
 *   `MsgType` is read FLAT, with no groups reconstructed, so it was never union-shaped.
 */
export type InboundUnion<Bodies> = {
  [M in keyof Bodies & string]: InboundOf<Bodies, M>;
}[keyof Bodies & string];

/**
 * A guard that separates a received message the dictionary knows from one it does not,
 * narrowing the former to {@link InboundUnion} so it can be dispatched with `switch`. Build
 * one with {@link inboundKnownGuard}.
 */
export type InboundKnownGuard<Bodies> = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  message: InboundMessage<any>,
) => message is InboundUnion<Bodies>;

/**
 * Build an {@link InboundKnownGuard} over a dictionary — the step that has to precede a
 * `switch (message.msgType)` dispatch, because an unknown `MsgType` cannot be a union
 * member (see {@link InboundUnion}).
 *
 * The runtime test is `dictionary.messageByMsgType(msgType) !== undefined`. That stands in
 * for "is a key of `Bodies`", which is not testable at runtime — `Bodies` is a type. The
 * two agree as long as the dictionary and the `Bodies` map come from the SAME dict package,
 * since the generator emits `MessageBodies` from this very dictionary; pairing a `Bodies`
 * from one dialect with a dictionary from another is a mistake this cannot catch, the same
 * way {@link messageFactory} cannot.
 *
 * ```ts
 * import { inboundKnownGuard } from '@boarteam/fix';
 * import { dictionary, type MessageBodies } from '@boarteam/fix-dict-fix44';
 *
 * const isKnownInbound = inboundKnownGuard<MessageBodies>(dictionary);
 * ```
 *
 * @param dict The dictionary the messages were parsed against (a {@link DictionaryJSON} is loaded for you).
 * @returns The narrowing guard; its runtime is one dictionary lookup.
 */
export function inboundKnownGuard<Bodies>(
  dict: Dictionary | DictionaryJSON,
): InboundKnownGuard<Bodies> {
  const d = dict instanceof Dictionary ? dict : loadDictionary(dict);
  return (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    message: InboundMessage<any>,
  ): message is InboundUnion<Bodies> => d.messageByMsgType(message.msgType) !== undefined;
}
