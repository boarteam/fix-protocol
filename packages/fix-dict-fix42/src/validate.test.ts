import { describe, expect, it } from 'vitest';
import {
  type Dictionary,
  type FixIssue,
  type MemberRef,
  type ParsedGroupEntry,
  type ParsedMessage,
  loadDictionary,
  validate,
} from '@boarteam/fix';
import { dictionary } from './index';

const dict = loadDictionary(dictionary);

/** A datatype-appropriate, conformant wire value for a field. */
function validValue(
  d: Dictionary,
  field: NonNullable<ReturnType<Dictionary['fieldByTag']>>,
): string {
  if (field.tag === 8) {
    return d.beginString;
  }
  if (field.enumValues && field.enumValues.length > 0) {
    return field.enumValues[0]!.value;
  }
  const resolved = d.resolveDatatype(field.type);
  if (resolved?.isBoolean) {
    return 'Y';
  }
  switch (field.type) {
    case 'UTCTimestamp':
      return '20240115-12:30:00.000';
    case 'UTCTimeOnly':
      return '12:30:00';
    case 'UTCDate': // FIX 4.2 spelling
    case 'UTCDateOnly':
    case 'LocalMktDate':
      return '20240115';
    case 'MonthYear': // FIX 4.2 spelling
    case 'month-year':
      return '202401';
    case 'Currency':
      return 'USD';
  }
  if (!resolved) {
    return 'X';
  }
  switch (resolved.base) {
    case 'int':
      return '1';
    case 'float':
      return '1';
    case 'char':
      return 'A';
    case 'data':
      return 'DATA';
    default:
      return 'X';
  }
}

interface Built {
  fields: Record<number, { tag: number; name?: string; raw: string; value: string }>;
  groups: Record<number, ParsedGroupEntry[]>;
}

/**
 * Build a minimal conformant container for a member list: every required field/group present
 * with valid values, optional members omitted. Components are inlined; a required `data` field
 * pulls in its `Length` companion so the conditional rule is satisfied.
 */
function buildContainer(d: Dictionary, members: MemberRef[], msgType: string): Built {
  const fields: Built['fields'] = {};
  const groups: Built['groups'] = {};

  const addField = (tag: number): void => {
    const f = d.fieldByTag(tag);
    if (!f || fields[tag]) {
      return;
    }
    const raw = tag === 35 ? msgType : validValue(d, f);
    fields[tag] = { tag, name: f.name, raw, value: raw };
    const resolved = d.resolveDatatype(f.type);
    if (resolved?.lengthPrefixed && f.lengthField !== undefined && !fields[f.lengthField]) {
      const lf = d.fieldByTag(f.lengthField);
      if (lf) {
        fields[f.lengthField] = { tag: f.lengthField, name: lf.name, raw: '4', value: '4' };
      }
    }
  };

  for (const member of members) {
    if (member.kind === 'field') {
      if (member.reqd === 'Y') {
        addField(member.tag);
      }
    } else if (member.kind === 'group') {
      if (member.reqd === 'Y') {
        const entry = buildContainer(d, member.members, msgType);
        groups[member.counterTag] = [{ fields: entry.fields, groups: entry.groups }];
      }
    } else if (member.reqd === 'Y') {
      const component = d.component(member.name);
      if (component) {
        const inner = buildContainer(d, component.members, msgType);
        Object.assign(fields, inner.fields);
        Object.assign(groups, inner.groups);
      }
    }
  }
  return { fields, groups };
}

function buildValidMessage(d: Dictionary, msgType: string): ParsedMessage {
  const def = d.messageByMsgType(msgType)!;
  const built = buildContainer(d, def.members, msgType);
  return { msgType, name: def.name, framed: true, fields: built.fields, groups: built.groups };
}

const errorsOf = (issues: FixIssue[]): FixIssue[] => issues.filter((i) => i.severity === 'error');

// A spread across session (admin) and application messages, including ones with required
// repeating groups (E has NoOrders; V/W/X have market-data groups) and nested structure.
const MESSAGE_TYPES = ['0', '1', '2', '3', '4', '5', 'A', 'D', 'E', 'V', 'W', 'X', '8'];

describe('validate over the full FIX 4.2 dictionary', () => {
  for (const msgType of MESSAGE_TYPES) {
    it(`a minimal conformant ${dict.messageByMsgType(msgType)?.name} (${msgType}) validates with no errors`, () => {
      const issues = validate(buildValidMessage(dict, msgType), dict);
      expect(errorsOf(issues)).toEqual([]);
    });
  }

  it('flags a dropped required field', () => {
    const msg = buildValidMessage(dict, 'A'); // Logon
    // EncryptMethod (98) is required in Logon; drop it.
    expect(msg.fields[98]).toBeDefined();
    delete msg.fields[98];
    const issues = validate(msg, dict);
    expect(
      issues.some((i) => i.code === 'validate/required-field-missing' && i.refTagID === 98),
    ).toBe(true);
  });

  it('flags an out-of-range enum value', () => {
    const msg = buildValidMessage(dict, 'D'); // OrderSingle
    msg.fields[54] = { tag: 54, name: 'Side', raw: '~', value: '~' }; // not a valid Side
    const issues = validate(msg, dict);
    expect(issues.some((i) => i.code === 'validate/value-not-in-enum' && i.refTagID === 54)).toBe(
      true,
    );
  });

  it('flags a required field dropped from a required group entry (deep, indexed path)', () => {
    // W (MarketDataSnapshotFullRefresh) has required group NoMDEntries(268) whose entries must
    // carry MDEntryType(269). Drop it from the built entry and assert the indexed path.
    const msg = buildValidMessage(dict, 'W');
    const groupEntry = msg.groups[268]?.[0];
    expect(groupEntry?.fields[269]).toBeDefined();
    delete groupEntry!.fields[269];
    const issues = validate(msg, dict);
    const miss = issues.find(
      (i) => i.code === 'validate/required-field-missing' && i.refTagID === 269,
    );
    expect(miss?.path).toBe('NoMDEntries[0].MDEntryType');
    expect(miss?.sessionRejectReason).toBe(1);
  });

  it('never throws and returns an array for every message type', () => {
    for (const msgType of MESSAGE_TYPES) {
      const issues = validate(buildValidMessage(dict, msgType), dict);
      expect(Array.isArray(issues)).toBe(true);
    }
  });
});
