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

describe('FIX 4.2 round-trip across all 46 messages', () => {
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

  it('reconstructs nested groups as arrays of objects (NewOrderList: NoOrders > NoAllocs)', () => {
    const e = encode(synthMessage('E'), dict);
    const { message } = parse(e, dict);
    const orders = message.groups[73]; // NoOrders
    expect(Array.isArray(orders)).toBe(true);
    expect(orders!.length).toBe(1);
    const order = orders![0]!;
    expect(typeof order.fields).toBe('object');
    expect(order.fields[11]).toBeDefined(); // ClOrdID (the NoOrders delimiter)
    // The nested NoAllocs group lives INSIDE the order entry, keyed by its counter tag.
    expect(Array.isArray(order.groups[78])).toBe(true);
    expect(order.groups[78]![0]!.fields[79]).toBeDefined(); // AllocAccount
  });
});

describe('FIX 4.2 golden decode', () => {
  it('OrderSingle (D): NoAllocs entries are objects keyed by tag', () => {
    const d = encode(synthMessage('D'), dict);
    const { message, issues } = parse(d, dict);
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(message.name).toBe('OrderSingle');
    expect(message.groups[78]).toBeDefined();
    const e0 = message.groups[78]![0]!;
    expect(e0.fields[79]?.name).toBe('AllocAccount'); // the group delimiter
    // 79 is reachable ONLY through the group, never as a flat top-level field.
    expect(message.fields[79]).toBeUndefined();
  });

  it('exposes coerced values and field names for ergonomic access', () => {
    const d = encode(
      {
        msgType: 'D',
        fields: {
          49: 'CLIENT',
          56: 'SERVER',
          34: 7,
          52: '20260620-12:00:00',
          11: 'ORD1',
          21: '1',
          55: 'EURUSD',
          54: '1',
          60: '20260620-12:00:00',
          40: '1',
          38: 100,
        },
        groups: {
          78: [{ fields: { 79: 'ACC1', 80: '60' } }, { fields: { 79: 'ACC2', 80: '40' } }],
        },
      },
      dict,
    );
    const { message } = parse(d, dict);
    expect(message.fields[34]?.value).toBe(7); // MsgSeqNum coerced to a number
    expect(message.fields[38]?.value).toBe(100); // OrderQty (Qty → float) coerced to a number
    expect(message.groups[78]!.map((e) => e.fields[79]!.value)).toEqual(['ACC1', 'ACC2']);
    expect(message.fields[55]?.value).toBe('EURUSD');
  });
});
