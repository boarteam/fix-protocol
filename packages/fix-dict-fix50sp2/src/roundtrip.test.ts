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

describe('FIX 5.0 SP2 round-trip across all 115 messages', () => {
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

  it('frames every message with the FIXT.1.1 BeginString, session and app alike', () => {
    for (const msgType of ['A', '0', 'D', '8', 'W']) {
      const wire = encode(synthMessage(msgType), dict);
      expect(wire.startsWith('8=FIXT.1.1\x01'), msgType).toBe(true);
      const { message, issues } = parse(wire, dict);
      expect(message.beginString).toBe('FIXT.1.1');
      // The framed BeginString matches the dictionary — no begin-string-mismatch warning.
      expect(issues.filter((i) => i.code === 'parse/begin-string-mismatch')).toEqual([]);
    }
  });
});

describe('FIX 5.0 SP2 golden decode (app messages under the FIXT envelope)', () => {
  it('ExecutionReport (8): parses with the FIXT header fields intact', () => {
    const wire = encode(
      {
        msgType: '8',
        fields: {
          49: 'VENUE',
          56: 'TRADER',
          34: 42,
          52: '20260801-12:00:00',
          1128: '9', // per-message ApplVerID override rides in the header
          37: 'ORD-1', // OrderID
          17: 'EXEC-1', // ExecID
          150: '0', // ExecType = New
          39: '0', // OrdStatus = New
          55: 'EURUSD',
          54: '1',
          151: '100', // LeavesQty
          14: '0', // CumQty
        },
      },
      dict,
    );
    const { message, issues } = parse(wire, dict);
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(message.name).toBe('ExecutionReport');
    expect(message.beginString).toBe('FIXT.1.1');
    expect(message.fields[1128]?.raw).toBe('9');
    expect(message.fields[150]?.name).toBe('ExecType');
  });

  it('MarketDataSnapshotFullRefresh (W): NoMDEntries entries are objects keyed by tag', () => {
    const wire = encode(
      {
        msgType: 'W',
        fields: {
          49: 'VENUE',
          56: 'TRADER',
          34: 7,
          52: '20260801-12:00:00',
          55: 'EURUSD',
          262: 'req-1',
        },
        groups: {
          268: [{ fields: { 269: '0', 270: '1.1050' } }, { fields: { 269: '1', 270: '1.1052' } }],
        },
      },
      dict,
    );
    const { message, issues } = parse(wire, dict);
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(message.name).toBe('MarketDataSnapshotFullRefresh');
    expect(message.groups[268]!.map((e) => e.fields[270]!.raw)).toEqual(['1.1050', '1.1052']);
    // 269 is reachable ONLY through the group, never as a flat top-level field.
    expect(message.fields[269]).toBeUndefined();
  });

  it('Logon (A): the session message decodes with its required DefaultApplVerID', () => {
    const wire = encode(
      {
        msgType: 'A',
        fields: {
          49: 'ME',
          56: 'YOU',
          34: 1,
          52: '20260801-12:00:00',
          98: '0',
          108: 30,
          1137: '9',
        },
      },
      dict,
    );
    const { message, issues } = parse(wire, dict);
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(message.name).toBe('Logon');
    expect(message.fields[1137]?.raw).toBe('9');
    expect(message.fields[34]?.value).toBe(1); // MsgSeqNum coerced to a number
  });
});
