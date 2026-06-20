/**
 * The Dictionary JSON contract: plain, serializable data describing a FIX dialect
 * (fields, datatypes, enums, components, repeating groups, and messages).
 *
 * This is the stable interchange format between `@boarteam/fix-codegen` (which emits it
 * from a spec source) and the `@boarteam/fix` engine (which runs over it). It is pure
 * data — no methods, no classes — so it round-trips through `JSON.stringify`/`parse` and
 * can be authored, diffed, and shipped as a `.json`/`.ts` file. The runtime index built
 * over it lives in {@link ./Dictionary}.
 *
 * Design notes:
 * - Repeating-group nesting is represented structurally ({@link GroupMember.members}),
 *   not by a flattened depth marker — the codegen reconstructs the tree from the spec.
 * - Components are kept as *references* ({@link ComponentMember}); the runtime expands
 *   them. This mirrors the FIX spec's reuse model and keeps the data compact.
 * - Enum values are opaque on-the-wire strings (never numbers): `"0"`, `"004"`, `"AB"`
 *   all stay verbatim, because parsing them as numbers would corrupt leading-zero codes.
 */

/** Required-ness of a member: `Y` required, `N` optional, `C` conditional (rule in prose). */
export type Reqd = 'Y' | 'N' | 'C';

/** The five root FIX datatypes every other datatype derives from. */
export type BaseType = 'int' | 'float' | 'char' | 'String' | 'data';

/**
 * A FIX datatype (e.g. `Price`, `UTCTimestamp`, `month-year`). Datatypes form a
 * derivation tree rooted at the five {@link BaseType}s; {@link base} is the transitive
 * root that determines wire coercion, while {@link parent} preserves the immediate edge.
 */
export interface DataTypeDef {
  /** The datatype name exactly as the spec writes it, e.g. `"Price"`, `"month-year"`. */
  name: string;
  /** The transitive root primitive, which drives value coercion/validation. */
  base: BaseType;
  /** Immediate parent in the derivation tree; absent for the five roots. */
  parent?: string;
  /** Human format hint, e.g. `"YYYYMMDD-HH:MM:SS[.sss]"`; present for date/time types. */
  formatPattern?: string;
  /** `true` for `data`: the value is preceded by a `Length` field and may embed `SOH`. */
  lengthPrefixed?: boolean;
  /**
   * The token delimiter for a list-valued datatype (`" "` for `MultipleValueString`).
   * Absent for single-valued datatypes. The value *is* the delimiter, not a flag.
   */
  multiValueDelimiter?: string;
  /** Original prose description from the spec. */
  description?: string;
}

/** One allowed value of an enumerated field. */
export interface EnumValue {
  /** The on-the-wire value, verbatim and opaque (`"1"`, `"004"`, `"AB"`). */
  value: string;
  /** A code-identifier-safe name derived from {@link description} (e.g. `"Buy"`). */
  name: string;
  /** The spec's human description of this value. */
  description: string;
}

/**
 * A FIX field definition, keyed by its numeric tag in {@link DictionaryJSON.fields}.
 */
export interface FieldDef {
  /** The field's numeric tag. */
  tag: number;
  /** The field's spec name, e.g. `"Side"`. Unique across the dictionary. */
  name: string;
  /** The {@link DataTypeDef.name} of this field's datatype. */
  type: string;
  /** Allowed values, when the field is enumerated (its `## Valid values` table). */
  enumValues?: EnumValue[];
  /**
   * `true` when this field's datatype is `NumInGroup` — i.e. it heads a repeating group.
   * Mirrored here so the runtime need not resolve the datatype to detect counters.
   */
  isGroupCounter?: boolean;
  /**
   * For a length-prefixed `data` field (datatype `base` `data`), the tag of the `Length`
   * field that carries this field's byte count and immediately precedes it on the wire
   * (e.g. `RawData` 96 → `lengthField` 95). The parser needs this to read a `data` value
   * whose payload may itself embed the `SOH` separator. Absent for non-`data` fields.
   */
  lengthField?: number;
  /** Original prose description from the spec. */
  description?: string;
}

/** A plain field reference within a message, component, or group body. */
export interface FieldMember {
  kind: 'field';
  /** The referenced {@link FieldDef.tag}. */
  tag: number;
  /** Whether the field is required in this context. */
  reqd: Reqd;
}

/** A reference to a reusable component block; the runtime expands it in place. */
export interface ComponentMember {
  kind: 'component';
  /** The referenced {@link ComponentDef.name}. */
  name: string;
  /** Whether the component is required in this context. */
  reqd: Reqd;
}

/**
 * A repeating group: a `NumInGroup` counter field ({@link counterTag}) followed by
 * {@link count} repetitions of {@link members}. The delimiter (first) field is not stored
 * — the runtime resolves it by walking {@link members} (through any leading component).
 */
export interface GroupMember {
  kind: 'group';
  /** The counter field's tag (a `NumInGroup` field). */
  counterTag: number;
  /** Whether the group is required in this context. */
  reqd: Reqd;
  /** The ordered body of one group entry; may itself contain components and groups. */
  members: MemberRef[];
  /**
   * `true` when this group's body was not present inline in the spec source and was
   * filled from the canonical body for {@link counterTag} (a known limitation of the
   * flattened Markdown source). Surfaced for honest coverage reporting; absent when the
   * body came straight from the spec.
   */
  bodyFromCanonical?: boolean;
}

/** A member of a message, component, or group body. */
export type MemberRef = FieldMember | ComponentMember | GroupMember;

/** A reusable component block (e.g. `Instrument`, `Standard Message Header`). */
export interface ComponentDef {
  /** The component's spec name, e.g. `"Instrument"`. */
  name: string;
  /** The ordered members of the component. */
  members: MemberRef[];
}

/** A message's session category. `admin` = session-level; `app` = application-level. */
export type MessageCategory = 'admin' | 'app';

/** A FIX message definition. */
export interface MessageDef {
  /** The message's spec name, e.g. `"Logon"`. */
  name: string;
  /** The `MsgType` value (tag 35), case-sensitive (`"A"`, `"a"`, `"AB"`). */
  msgType: string;
  /** Session (`admin`) vs application (`app`) message. */
  category: MessageCategory;
  /**
   * The ordered members, including the leading `Standard Message Header` and trailing
   * `Standard Message Trailer` component references exactly as the spec lists them.
   */
  members: MemberRef[];
}

/**
 * A note about something the generated dictionary could not fully express, recorded for
 * honest maturity reporting (per the open-source-readiness standard).
 */
export interface CoverageGap {
  /** Stable kind identifier, e.g. `"nested-group-canonical"`, `"unresolved-group"`. */
  kind: string;
  /** Where the gap is, e.g. a message name + counter tag. */
  where: string;
  /** What the dictionary cannot express and why. */
  detail: string;
}

/** The complete, serializable dictionary. */
export interface DictionaryJSON {
  /** Dialect identifier, e.g. `"FIX.4.4"`. Matches the `BeginString` (tag 8) value. */
  version: string;
  /** The `BeginString` (tag 8) value framed messages must carry, e.g. `"FIX.4.4"`. */
  beginString: string;
  /** Provenance: what generated this dictionary and from what source. */
  source?: { generator: string; spec: string; generatedFrom?: string };
  /** Datatypes by name. */
  datatypes: Record<string, DataTypeDef>;
  /** Fields by numeric tag. */
  fields: Record<number, FieldDef>;
  /** Components by name. */
  components: Record<string, ComponentDef>;
  /** Messages, in spec order. */
  messages: MessageDef[];
  /** Known limitations of this generated dictionary. */
  coverageGaps?: CoverageGap[];
}
