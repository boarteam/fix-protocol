import type { Dictionary } from '../dictionary/Dictionary';
import type { ComponentDef, MemberRef } from '../dictionary/types';
import { calculateChecksum, bodyLength as byteLength } from './checksum';
import { SOH } from './tokenize';

/** A scalar field value the caller can supply. Booleans map to `Y`/`N`. */
export type FieldValue = string | number | boolean;

/** One entry of a repeating group: its own fields and any nested groups. */
export interface GroupEntry {
  /** Field values for this entry, keyed by tag. */
  fields?: Record<number, FieldValue>;
  /** Nested groups within this entry, keyed by counter tag. */
  groups?: Record<number, GroupEntry[]>;
}

/** The message to encode. Framing tags (8/9/10) are computed and need not be supplied. */
export interface EncodeMessage {
  /** The `MsgType` (tag 35) value. */
  msgType: string;
  /** Top-level field values, keyed by tag. `SendingTime`/`MsgSeqNum`/comp-IDs go here. */
  fields?: Record<number, FieldValue>;
  /** Top-level repeating groups, keyed by counter tag. */
  groups?: Record<number, GroupEntry[]>;
}

export interface EncodeOptions {
  /** Field separator for the output. Defaults to {@link SOH}. */
  soh?: string;
}

/** Tags the framing computes; never emitted from caller data. */
const FRAMING = new Set([8, 9, 10]);
const MSG_TYPE = 35;

/**
 * Encode a message into a complete, framed FIX string: fields are emitted in the order
 * the dictionary prescribes for the message (expanding components and repeating groups),
 * then `BeginString`/`BodyLength` are prefixed and `CheckSum` appended.
 *
 * The framing math is byte-accurate (UTF-8), so non-ASCII values produce spec-correct
 * `BodyLength`/`CheckSum`. The function is pure: it reads only the supplied data and the
 * dictionary — no wall-clock, sequence numbers, or comp-ID lookups (supply those in
 * {@link EncodeMessage.fields}). Presence/enum validity are not checked here; run
 * `validate` for that. Throws only on programming errors, never on absent fields: when
 * {@link EncodeMessage.msgType} is unknown to the dictionary, or when a numeric value
 * cannot be rendered as a valid FIX value (non-finite, or one that `String()` would emit
 * in exponent notation — pass such values as pre-formatted strings).
 *
 * @returns the framed message, terminated by a trailing separator.
 */
export function encode(
  message: EncodeMessage,
  dict: Dictionary,
  options: EncodeOptions = {},
): string {
  const soh = options.soh ?? SOH;
  const def = dict.messageByMsgType(message.msgType);
  if (!def) {
    throw new Error(`encode: unknown MsgType "${message.msgType}" in dictionary ${dict.version}`);
  }

  const parts: string[] = [`${MSG_TYPE}=${message.msgType}`];
  emitMembers(def.members, message.fields ?? {}, message.groups ?? {}, dict, parts, new Set());

  const body = parts.join(soh) + soh;
  const head = `8=${dict.beginString}${soh}9=${byteLength(body)}${soh}`;
  const framed = head + body;
  return `${framed}10=${calculateChecksum(framed)}${soh}`;
}

function emitMembers(
  members: MemberRef[],
  fields: Record<number, FieldValue>,
  groups: Record<number, GroupEntry[]>,
  dict: Dictionary,
  out: string[],
  seenComponents: Set<string>,
): void {
  for (const member of members) {
    switch (member.kind) {
      case 'field': {
        if (FRAMING.has(member.tag) || member.tag === MSG_TYPE) {
          break; // computed by framing / emitted up front
        }
        const value = fields[member.tag];
        if (value !== undefined) {
          out.push(`${member.tag}=${formatValue(value)}`);
        }
        break;
      }
      case 'group': {
        const entries = groups[member.counterTag];
        if (!entries || entries.length === 0) {
          break;
        }
        out.push(`${member.counterTag}=${entries.length}`);
        for (const entry of entries) {
          emitMembers(member.members, entry.fields ?? {}, entry.groups ?? {}, dict, out, new Set());
        }
        break;
      }
      case 'component': {
        if (seenComponents.has(member.name)) {
          break;
        }
        const component: ComponentDef | undefined = dict.component(member.name);
        if (component) {
          const nextSeen = new Set(seenComponents);
          nextSeen.add(member.name);
          emitMembers(component.members, fields, groups, dict, out, nextSeen);
        }
        break;
      }
    }
  }
}

function formatValue(value: FieldValue): string {
  if (typeof value === 'boolean') {
    return value ? 'Y' : 'N';
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(
        `encode: cannot render non-finite number (${value}) as a FIX value; pass a pre-formatted string`,
      );
    }
    const rendered = String(value);
    if (rendered.includes('e') || rendered.includes('E')) {
      throw new Error(
        `encode: number ${rendered} would be emitted in exponent notation, which is not a valid FIX value; pass a pre-formatted string`,
      );
    }
    return rendered;
  }
  return value;
}
