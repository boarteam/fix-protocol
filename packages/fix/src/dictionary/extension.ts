/**
 * The dictionary extension schema: ONE declaration describing venue-specific additions
 * (fields, enum values, components, messages, and placements into existing structures)
 * that drives BOTH layers of dictionary extensibility:
 *
 * - the runtime merge — {@link extendDictionary} applies the
 *   declaration to a {@link DictionaryJSON} and reports `extend/*` issues;
 * - the typing bridge — {@link tagsOf}/{@link msgTypesOf} derive literal `name → tag` /
 *   `name → msgType` maps from the same declaration, ready for
 *   {@link extendTags}/{@link invertTags}.
 *
 * Everything is keyed by NAME (tags live in values): the record shape makes the
 * key/tag-mismatch and duplicate-name-in-extension authoring errors unrepresentable,
 * and is exactly what the literal-type derivation needs.
 *
 * Wrap the declaration in {@link defineExtension} — a zero-cost identity whose TS 5
 * `const` type parameter pins every literal (no `as const` needed) and whose
 * {@link GuardWidening} constraint turns an accidentally widened declaration into a
 * readable compile error instead of silently degrading the derived types.
 */
import type { MessageCategory, Reqd } from './types';

/** One allowed value to add to a field's enum. `description` defaults to `name`. */
export interface ExtensionEnumValue {
  /** The on-the-wire value, verbatim and opaque (`"1"`, `"004"`, `"AB"`). */
  readonly value: string;
  /** A code-identifier-safe name, e.g. `"Buy"`. The identity on conflicts. */
  readonly name: string;
  /** Human description; defaults to {@link name} when omitted. */
  readonly description?: string;
}

/**
 * A new field. Keyed by its NAME in {@link DictionaryExtension.fields}; the tag lives
 * here. `isGroupCounter` is never authored — it is inferred from {@link type} deriving
 * from `NumInGroup`, mirroring the invariant documented on the dictionary contract.
 */
export interface ExtensionFieldDef {
  /** The field's numeric tag, e.g. `1007`. */
  readonly tag: number;
  /** Must name an existing datatype in the target dictionary (`'String'`, `'int'`, `'Price'`, …). */
  readonly type: string;
  /** Allowed values, when the new field is enumerated. */
  readonly enumValues?: readonly ExtensionEnumValue[];
  /** For a `data`-based field: the tag of the companion `Length` field preceding it. */
  readonly lengthField?: number;
  /** Human description, carried into the merged {@link FieldDef}. */
  readonly description?: string;
}

/**
 * A member to place into a body. The string shorthand is an optional field by name
 * (`reqd: 'N'`). Names resolve against the extension's own {@link DictionaryExtension.fields}
 * first, then the base dictionary's fields/components.
 */
export type MemberSpec =
  | string
  | { readonly field: string; readonly reqd?: Reqd }
  | { readonly component: string; readonly reqd?: Reqd }
  | {
      /** A NEW nested repeating group; `group` names its counter field. */
      readonly group: string;
      readonly reqd?: Reqd;
      readonly members: readonly MemberSpec[];
    };

/** Members to add to one repeating group's entry body. */
export interface GroupExtension {
  /** The members to add to the entry body, in order. */
  readonly append: readonly MemberSpec[];
  /**
   * Anchor member (field/component/group-counter name) to insert immediately AFTER;
   * omit to append at the end of the entry body (which is also the encode position).
   * `before`/`start` are deliberately unsupported: a group's first body field is its
   * entry delimiter, and inserting ahead of it would change entry detection.
   */
  readonly after?: string;
}

/** A patch to an existing message (addressed by name via the record key). */
export interface MessageExtension {
  /** Never set on a patch — its presence is what marks an entry as a {@link NewMessageSpec}. */
  readonly msgType?: never;
  /** Appended at the end of the body, kept BEFORE the trailing Standard Message Trailer. */
  readonly append?: readonly MemberSpec[];
  /** Anchor for {@link append}, as in {@link GroupExtension.after}. */
  readonly after?: string;
  /**
   * Additions to EXISTING repeating groups, keyed by counter-field-name path — dotted
   * for nesting (`'NoRelatedSym.NoUnderlyings'`). A group that lives behind a shared
   * component is auto-resolved only when it is reachable via exactly one
   * single-reference component chain; otherwise the placement is refused with a
   * `extend/target-not-found` hint naming the component to target explicitly.
   */
  readonly groups?: Readonly<Record<string, GroupExtension>>;
}

/** A brand-new message (the presence of `msgType` is what marks an entry as new). */
export interface NewMessageSpec {
  /** The `MsgType` (tag 35) value, case-sensitive (`'U1'`, `'UP1'`, …). */
  readonly msgType: string;
  /** Session (`admin`) vs application (`app`) message. Defaults to `'app'`. */
  readonly category?: MessageCategory;
  /**
   * Body only — the base dictionary's Standard Message Header/Trailer component refs
   * are injected automatically (reported via `extend/header-trailer-injected`).
   */
  readonly members: readonly MemberSpec[];
}

/**
 * A component entry: `{ members }` defines a NEW component; the other form extends an
 * existing one (additions become visible in every referencing scope — deliberate, and
 * reported via `extend/component-fanout`).
 */
export type ComponentExtension =
  | { readonly members: readonly MemberSpec[] }
  | {
      readonly append?: readonly MemberSpec[];
      readonly after?: string;
      readonly groups?: Readonly<Record<string, GroupExtension>>;
    };

/** One venue extension declaration — the single source of truth for both layers. */
export interface DictionaryExtension {
  /** Provenance label, e.g. `'ctrader'`; echoed into issue paths and the merged JSON. */
  readonly id?: string;
  /** New fields, keyed by NAME. */
  readonly fields?: Readonly<Record<string, ExtensionFieldDef>>;
  /** Enum values appended to EXISTING fields, keyed by field NAME. */
  readonly enums?: Readonly<Record<string, readonly ExtensionEnumValue[]>>;
  /** New components and additions to existing ones, keyed by component name. */
  readonly components?: Readonly<Record<string, ComponentExtension>>;
  /** New messages and patches to existing ones, keyed by message name. */
  readonly messages?: Readonly<Record<string, MessageExtension | NewMessageSpec>>;
}

// --- literal-type derivation (zero runtime cost) -----------------------------------------

type FieldsOf<E extends DictionaryExtension> = E['fields'] & {};
type MsgsOf<E extends DictionaryExtension> = E['messages'] & {};

/**
 * The literal `name → tag` map type derived from an extension's `fields` record —
 * `TagsOf<typeof ctrader>` is `{ readonly SymbolName: 1007; readonly SymbolDigits: 1008 }`.
 * Feed the value-level counterpart {@link tagsOf} to `extendTags`.
 */
export type TagsOf<E extends DictionaryExtension> = Readonly<{
  [K in keyof FieldsOf<E> & string]: FieldsOf<E>[K] extends { tag: infer T extends number }
    ? T
    : never;
}>;

/**
 * The literal `name → msgType` map type derived from an extension's NEW messages
 * (entries carrying `msgType`); message patches are excluded.
 */
export type MsgTypesOf<E extends DictionaryExtension> = Readonly<{
  [
    K in keyof MsgsOf<E> & string as MsgsOf<E>[K] extends { msgType: string } ? K : never
  ]: MsgsOf<E>[K] extends { msgType: infer M extends string } ? M : never;
}>;

/**
 * The compile error surfaced by {@link GuardWidening} when an extension's literals were
 * widened before reaching {@link defineExtension}. Not meant to be used directly.
 */
export interface WidenedExtensionError {
  /** The remedy, carried in the property NAME so it reads in full inside editor hovers. */
  readonly 'ERROR: extension literals were widened': 'declare the extension inline at the defineExtension call site (or as const) so tags stay literal types like 1007';
}

/**
 * Compile-time guard: resolves to `unknown` (no-op) when the extension's tag and
 * msgType literals survived inference, and to {@link WidenedExtensionError} when they
 * widened to `number`/`string` — which happens when the declaration was pre-typed as
 * {@link DictionaryExtension} before the call. Without this, the flagship literal
 * hovers would silently degrade; with it, the degradation is a readable type error.
 */
export type GuardWidening<E extends DictionaryExtension> = (TagsOf<E>[keyof TagsOf<E>] extends never
  ? unknown
  : number extends TagsOf<E>[keyof TagsOf<E>]
    ? WidenedExtensionError
    : unknown) &
  (MsgTypesOf<E>[keyof MsgTypesOf<E>] extends never
    ? unknown
    : string extends MsgTypesOf<E>[keyof MsgTypesOf<E>]
      ? WidenedExtensionError
      : unknown);

/**
 * Pin an extension declaration's literal types once — a zero-cost identity whose TS 5
 * `const` type parameter keeps every `tag: 1007` / `msgType: 'UP1'` literal without
 * `as const`, so the SAME value can drive `extendDictionary` (runtime) and
 * {@link tagsOf}/{@link msgTypesOf} (types).
 *
 * ```ts
 * const ctrader = defineExtension({
 *   id: 'ctrader',
 *   fields: {
 *     SymbolName:   { tag: 1007, type: 'String' },
 *     SymbolDigits: { tag: 1008, type: 'int' },
 *   },
 *   messages: {
 *     SecurityList: { groups: { NoRelatedSym: { append: ['SymbolName', 'SymbolDigits'] } } },
 *   },
 * });
 * ```
 * @param ext The extension declaration, written inline so its literals stay narrow.
 * @returns The same object, its literal types pinned.
 */
export function defineExtension<const E extends DictionaryExtension>(ext: E & GuardWidening<E>): E {
  return ext;
}

/**
 * Derive the literal `name → tag` map from an extension declaration, typed as
 * {@link TagsOf}. Pure and total; collisions are the runtime merge's concern.
 *
 * ```ts
 * export const Tags = extendTags(Fix44Tags, tagsOf(ctrader)); // Tags.SymbolName: 1007
 * ```
 * @param ext The extension declaration to derive from.
 * @returns The literal `name → tag` map of the extension’s fields.
 */
export function tagsOf<const E extends DictionaryExtension>(ext: E): TagsOf<E> {
  const out: Record<string, number> = {};
  for (const [name, def] of Object.entries(ext.fields ?? {})) {
    out[name] = def.tag;
  }
  return out as TagsOf<E>;
}

/**
 * Derive the literal `name → msgType` map of an extension's NEW messages, typed as
 * {@link MsgTypesOf}. Message patches (entries without `msgType`) are skipped.
 * @param ext The extension declaration to derive from.
 * @returns The literal `name → msgType` map of the extension’s NEW messages.
 */
export function msgTypesOf<const E extends DictionaryExtension>(ext: E): MsgTypesOf<E> {
  const out: Record<string, string> = {};
  for (const [name, spec] of Object.entries(ext.messages ?? {})) {
    if (typeof spec.msgType === 'string') {
      out[name] = spec.msgType;
    }
  }
  return out as MsgTypesOf<E>;
}
