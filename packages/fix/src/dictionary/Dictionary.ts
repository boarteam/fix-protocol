import type {
  ComponentDef,
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
    return this.json.components[name];
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

const EMPTY_TAGS: ReadonlySet<number> = new Set();

/**
 * Build a {@link Dictionary} runtime index from its JSON form. Does not validate the
 * JSON; run {@link ./validateDictionary.validateDictionary} first if the source is
 * untrusted.
 */
export function loadDictionary(json: DictionaryJSON): Dictionary {
  return new Dictionary(json);
}
