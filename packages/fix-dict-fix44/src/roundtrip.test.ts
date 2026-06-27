import { describe, expect, it } from 'vitest';
import {
  type EncodeMessage,
  type GroupEntry,
  type MemberRef,
  encode,
  loadDictionary,
  parse,
  toEncodeMessage,
} from '@boarteam/fix';
import { dictionary } from './index';

const dict = loadDictionary(dictionary);
const byteLen = (s: string) => new TextEncoder().encode(s).length;

// Framing tags are computed by the encoder, never supplied as data.
const COMPUTED = new Set([8, 9, 10, 35]);

/** A type-appropriate dummy wire value for a field, or `undefined` to omit it. */
function dummyFor(tag: number): string | undefined {
  if (COMPUTED.has(tag)) {
    return undefined;
  }
  const f = dict.fieldByTag(tag);
  if (!f) {
    return 'X';
  }
  if (f.enumValues && f.enumValues.length > 0) {
    return f.enumValues[0]!.value;
  }
  const r = dict.resolveDatatype(f.type);
  if (!r) {
    return 'X';
  }
  if (r.isBoolean) {
    return 'Y';
  }
  switch (r.base) {
    case 'int':
      return '1';
    case 'float':
      return '1';
    case 'char':
      return 'A';
    case 'data':
      return 'AB';
    default:
      return 'X';
  }
}

/** Build one fully-populated `{fields, groups}` container from a member list. */
function synthEntry(members: MemberRef[]): GroupEntry {
  const fields: Record<number, string> = {};
  const groups: Record<number, GroupEntry[]> = {};
  walk(members, fields, groups, new Set());
  return { fields, groups };
}

function walk(
  members: MemberRef[],
  fields: Record<number, string>,
  groups: Record<number, GroupEntry[]>,
  seen: Set<string>,
): void {
  for (const m of members) {
    if (m.kind === 'field') {
      if (fields[m.tag] === undefined) {
        const v = dummyFor(m.tag);
        if (v !== undefined) {
          fields[m.tag] = v;
        }
      }
    } else if (m.kind === 'component') {
      if (seen.has(m.name)) {
        continue;
      }
      const c = dict.component(m.name);
      if (c) {
        const next = new Set(seen);
        next.add(m.name);
        walk(c.members, fields, groups, next);
      }
    } else {
      // group: only synthesize an entry when the group is structurally resolvable
      // (the unresolved coverage-gap groups have an empty body / no delimiter).
      if (m.members.length === 0 || dict.groupDelimiterTag(m) === undefined) {
        continue;
      }
      if (groups[m.counterTag] === undefined) {
        groups[m.counterTag] = [synthEntry(m.members)];
      }
    }
  }
}

/** Set every `data` field's preceding `Length` field to the value's byte length. */
function fixupDataLengths(
  fields: Record<number, string>,
  groups: Record<number, GroupEntry[]> | undefined,
): void {
  for (const tagStr of Object.keys(fields)) {
    const tag = Number(tagStr);
    const f = dict.fieldByTag(tag);
    if (f?.lengthField !== undefined) {
      fields[f.lengthField] = String(byteLen(fields[tag]!));
    }
  }
  for (const entries of Object.values(groups ?? {})) {
    for (const e of entries) {
      fixupDataLengths(e.fields as Record<number, string>, e.groups);
    }
  }
}

function synthMessage(msgType: string): EncodeMessage {
  const def = dict.messageByMsgType(msgType)!;
  const { fields, groups } = synthEntry(def.members);
  fixupDataLengths(fields as Record<number, string>, groups);
  return { msgType, fields, groups };
}

describe('FIX 4.4 round-trip across all 93 messages', () => {
  it('encode→parse→encode is byte-stable for every message type', () => {
    const failures: string[] = [];
    for (const def of dictionary.messages) {
      const x1 = encode(synthMessage(def.msgType), dict);
      const { message } = parse(x1, dict);
      const x2 = encode(toEncodeMessage(message), dict);
      if (x1 !== x2) {
        failures.push(`${def.name} (${def.msgType})`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('parses every message type without any error-severity issues', () => {
    const offenders: string[] = [];
    for (const def of dictionary.messages) {
      const x1 = encode(synthMessage(def.msgType), dict);
      const { issues } = parse(x1, dict);
      const errors = issues.filter((i) => i.severity === 'error');
      if (errors.length > 0) {
        offenders.push(`${def.name}: ${errors.map((e) => e.code).join(',')}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('reconstructs deeply nested groups as arrays of objects (not parallel arrays)', () => {
    // Market Data Incremental (X): NoMDEntries(268) > NoUnderlyings(711) / NoLegs(555).
    const x = encode(synthMessage('X'), dict);
    const { message } = parse(x, dict);
    const entries = message.groups[268];
    expect(Array.isArray(entries)).toBe(true);
    expect(entries!.length).toBe(1);
    const entry = entries![0]!;
    expect(typeof entry.fields).toBe('object');
    expect(entry.fields[279]).toBeDefined(); // MDUpdateAction (delimiter)
    // Nested groups live INSIDE the entry object, keyed by their counter tag.
    expect(Array.isArray(entry.groups[711])).toBe(true);
    expect(entry.groups[711]![0]!.fields[311]).toBeDefined(); // UnderlyingSymbol
    expect(Array.isArray(entry.groups[555])).toBe(true);
  });
});

describe('FIX 4.4 golden decode — market data', () => {
  it('Market Data Snapshot (W): NoMDEntries entries are objects keyed by tag', () => {
    const w = encode(synthMessage('W'), dict);
    const { message, issues } = parse(w, dict);
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(message.name).toBe('MarketDataSnapshotFullRefresh');

    // The Instrument (Symbol 55) is a top-level field, not inside the MD group.
    expect(message.fields[55]?.name).toBe('Symbol');
    expect(message.groups[268]).toBeDefined();
    const e0 = message.groups[268]![0]!;
    expect(e0.fields[269]?.name).toBe('MDEntryType'); // the group delimiter
    // 269 is reachable ONLY through the group, never as a flat top-level field.
    expect(message.fields[269]).toBeUndefined();
  });

  it('exposes coerced values and field names for ergonomic access', () => {
    const v = encode(
      {
        msgType: 'V',
        fields: {
          49: 'CLIENT',
          56: 'SERVER',
          34: 7,
          52: '20260620-12:00:00',
          262: 'req-1',
          263: '1',
          264: 0,
        },
        groups: {
          267: [{ fields: { 269: '0' } }, { fields: { 269: '1' } }],
          146: [{ fields: { 55: 'EURUSD' } }],
        },
      },
      dict,
    );
    const { message } = parse(v, dict);
    expect(message.fields[34]?.value).toBe(7); // MsgSeqNum coerced to a number
    expect(message.fields[264]?.value).toBe(0); // MarketDepth coerced to a number
    expect(message.groups[267]!.map((e) => e.fields[269]!.value)).toEqual(['0', '1']);
    expect(message.groups[146]![0]!.fields[55]!.value).toBe('EURUSD');
  });
});
