import type {
  BaseType,
  ComponentDef,
  DataTypeDef,
  DictionaryJSON,
  FieldDef,
  GroupMember,
  MemberRef,
  MessageDef,
} from './types';

/**
 * A runtime index over a {@link DictionaryJSON}: fast lookup of fields, messages, and
 * components, plus the derived structure the codec needs — repeating-group delimiters,
 * component expansion, and per-message allowed-tag sets.
 *
 * The instance is immutable and holds a reference to the original JSON (exposed via
 * {@link json}); all derived data is computed lazily and memoised. Construct one with
 * {@link loadDictionary}.
 */
export class Dictionary {
  /** The underlying data this index was built from. */
  readonly json: DictionaryJSON;

  readonly #fieldsByName = new Map<string, FieldDef>();
  readonly #messagesByType = new Map<string, MessageDef>();
  readonly #messagesByName = new Map<string, MessageDef>();
  readonly #allowedTags = new Map<string, Set<number>>();
  // `null` caches a known-miss so an unknown datatype name is not re-resolved each call.
  readonly #resolvedDatatypes = new Map<string, ResolvedDatatype | null>();

  constructor(json: DictionaryJSON) {
    this.json = json;
    for (const field of Object.values(json.fields)) {
      this.#fieldsByName.set(field.name, field);
    }
    for (const message of json.messages) {
      // First definition wins on MsgType collisions (rare; e.g. a curated dialect that
      // reuses a code). Name is always unique.
      if (!this.#messagesByType.has(message.msgType)) {
        this.#messagesByType.set(message.msgType, message);
      }
      this.#messagesByName.set(message.name, message);
    }
  }

  /** Dialect identifier, e.g. `"FIX.4.4"`. */
  get version(): string {
    return this.json.version;
  }

  /** The `BeginString` (tag 8) value framed messages carry. */
  get beginString(): string {
    return this.json.beginString;
  }

  /** Look up a field by tag. */
  fieldByTag(tag: number): FieldDef | undefined {
    return this.json.fields[tag];
  }

  /** Look up a field by its spec name. */
  fieldByName(name: string): FieldDef | undefined {
    return this.#fieldsByName.get(name);
  }

  /** Look up a message by its `MsgType` value. */
  messageByMsgType(msgType: string): MessageDef | undefined {
    return this.#messagesByType.get(msgType);
  }

  /** Look up a message by its spec name. */
  messageByName(name: string): MessageDef | undefined {
    return this.#messagesByName.get(name);
  }

  /** Look up a component by name. */
  component(name: string): ComponentDef | undefined {
    return hasOwn(this.json.components, name) ? this.json.components[name] : undefined;
  }

  /** Look up a datatype by name. */
  datatype(name: string): DataTypeDef | undefined {
    return hasOwn(this.json.datatypes, name) ? this.json.datatypes[name] : undefined;
  }

  /**
   * Resolve a datatype name to the coercion-relevant facts the codec needs: the transitive
   * {@link BaseType} root plus the derivation-chain flags that change how a value is read
   * (`Boolean` char, the space-delimited list of `MultipleValueString`, length-prefixed
   * `data`). Walks the `parent` chain with a cycle guard so it is safe on an untrusted
   * dictionary, and memoises per datatype name.
   *
   * @returns the resolved facts, or `undefined` when the datatype name is unknown.
   */
  resolveDatatype(name: string): ResolvedDatatype | undefined {
    const cached = this.#resolvedDatatypes.get(name);
    if (cached !== undefined) {
      return cached ?? undefined;
    }
    const root = hasOwn(this.json.datatypes, name) ? this.json.datatypes[name] : undefined;
    if (!root) {
      this.#resolvedDatatypes.set(name, null);
      return undefined;
    }
    // `base` is already the transitive root primitive (the codegen flattens it); the chain
    // is walked only to surface flags that live on intermediate nodes — the `Boolean`
    // marker and the `MultipleValueString` delimiter.
    let isBoolean = false;
    let multiValueDelimiter: string | undefined;
    const seen = new Set<string>();
    let cursor: DataTypeDef | undefined = root;
    while (cursor && !seen.has(cursor.name)) {
      seen.add(cursor.name);
      if (cursor.name === 'Boolean') {
        isBoolean = true;
      }
      if (multiValueDelimiter === undefined && cursor.multiValueDelimiter !== undefined) {
        multiValueDelimiter = cursor.multiValueDelimiter;
      }
      cursor =
        cursor.parent && hasOwn(this.json.datatypes, cursor.parent)
          ? this.json.datatypes[cursor.parent]
          : undefined;
    }
    const resolved: ResolvedDatatype = {
      base: root.base,
      isBoolean,
      multiValueDelimiter,
      lengthPrefixed: root.base === 'data',
    };
    this.#resolvedDatatypes.set(name, resolved);
    return resolved;
  }

  /** Whether a tag heads a repeating group (its datatype is `NumInGroup`). */
  isGroupCounter(tag: number): boolean {
    return this.json.fields[tag]?.isGroupCounter === true;
  }

  /**
   * The delimiter (first) field tag of a repeating group: the tag that opens each entry
   * on the wire. Resolved by walking the group body in order — descending into a leading
   * component, or returning a leading nested group's counter — since FIX has no explicit
   * group delimiters and the parser keys entry boundaries off this tag.
   *
   * @returns the delimiter tag, or `undefined` if the body resolves to no field.
   */
  groupDelimiterTag(group: GroupMember): number | undefined {
    return this.#firstWireTag(group.members, new Set());
  }

  #firstWireTag(members: MemberRef[], seen: Set<string>): number | undefined {
    for (const member of members) {
      switch (member.kind) {
        case 'field':
          return member.tag;
        case 'group':
          // A nested group opens with its counter on the wire.
          return member.counterTag;
        case 'component': {
          if (seen.has(member.name)) {
            continue;
          }
          seen.add(member.name);
          const component = this.component(member.name);
          if (!component) {
            continue;
          }
          const tag = this.#firstWireTag(component.members, seen);
          if (tag !== undefined) {
            return tag;
          }
        }
      }
    }
    return undefined;
  }

  /**
   * The set of every field tag that may legitimately appear in a message, including
   * group counters and all fields reachable through nested components and groups (and the
   * standard header/trailer, which the message lists as components).
   *
   * Memoised per message name. Returns an empty set for an unknown message.
   */
  allowedTags(msgType: string): ReadonlySet<number> {
    const message = this.messageByMsgType(msgType);
    if (!message) {
      return EMPTY_TAGS;
    }
    // Keyed by msgType (the lookup key), not message.name: a custom dictionary may carry
    // two messages with the same name but different MsgTypes/bodies.
    let tags = this.#allowedTags.get(msgType);
    if (!tags) {
      tags = new Set<number>();
      this.#collectTags(message.members, tags, new Set());
      this.#allowedTags.set(msgType, tags);
    }
    return tags;
  }

  #collectTags(members: MemberRef[], out: Set<number>, seenComponents: Set<string>): void {
    for (const member of members) {
      switch (member.kind) {
        case 'field':
          out.add(member.tag);
          break;
        case 'group':
          out.add(member.counterTag);
          this.#collectTags(member.members, out, seenComponents);
          break;
        case 'component': {
          if (seenComponents.has(member.name)) {
            break;
          }
          seenComponents.add(member.name);
          const component = this.component(member.name);
          if (component) {
            this.#collectTags(component.members, out, seenComponents);
          }
          break;
        }
      }
    }
  }
}

/**
 * The coercion-relevant facts about a datatype, resolved from its derivation chain by
 * {@link Dictionary.resolveDatatype}. Drives how the codec reads a raw wire value.
 */
export interface ResolvedDatatype {
  /** The transitive root primitive that determines value coercion. */
  base: BaseType;
  /** `true` when the datatype derives from `Boolean` (`Y`/`N` → `true`/`false`). */
  isBoolean: boolean;
  /** The list separator when the datatype is multi-valued (`" "` for `MultipleValueString`). */
  multiValueDelimiter?: string;
  /** `true` for `data`: the value is length-prefixed and may embed the `SOH` separator. */
  lengthPrefixed: boolean;
}

const EMPTY_TAGS: ReadonlySet<number> = new Set();

/**
 * Own-property check used for every name-keyed lookup into the plain-object dictionary
 * collections. A datatype/component named like an `Object.prototype` member (`toString`,
 * `constructor`, `valueOf`, `__proto__`, …) must resolve to a miss, not the inherited
 * prototype member — important when running over an untrusted dictionary.
 */
function hasOwn(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/**
 * Build a {@link Dictionary} runtime index from its JSON form. Does not validate the
 * JSON; run {@link ./validateDictionary.validateDictionary} first if the source is
 * untrusted.
 */
export function loadDictionary(json: DictionaryJSON): Dictionary {
  return new Dictionary(json);
}
