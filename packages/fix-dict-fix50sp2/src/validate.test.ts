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
      return '20260801-12:30:00.000';
    case 'UTCTimeOnly':
    case 'LocalMktTime':
      return '12:30:00';
    case 'UTCDateOnly':
    case 'LocalMktDate':
      return '20260801';
    case 'MonthYear':
      return '202608';
    // The FIX 5.0 TZ types carry an optional ISO 8601 zone designator.
    case 'TZTimestamp':
      return '20260801-12:30:00+02:00';
    case 'TZTimeOnly':
      return '12:30Z';
    case 'Currency':
      return 'USD';
    case 'Country':
      return 'US';
    case 'Language':
      return 'en';
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

// A spread across the FIXT session layer (0-5, A) and the SP2 application layer, including
// messages with required repeating groups (E has NoOrders; W/X have market-data groups) and
// the app-layer reject (j).
const MESSAGE_TYPES = ['0', '1', '2', '3', '4', '5', 'A', 'D', 'E', '8', 'V', 'W', 'X', 'j', 'AE'];

describe('validate over the full FIX 5.0 SP2 dictionary', () => {
  for (const msgType of MESSAGE_TYPES) {
    it(`a minimal conformant ${dict.messageByMsgType(msgType)?.name} (${msgType}) validates with no errors`, () => {
      const issues = validate(buildValidMessage(dict, msgType), dict);
      expect(errorsOf(issues)).toEqual([]);
    });
  }

  it('flags a dropped DefaultApplVerID(1137) on Logon — the FIXT-required field', () => {
    const msg = buildValidMessage(dict, 'A');
    expect(msg.fields[1137]).toBeDefined();
    delete msg.fields[1137];
    const issues = validate(msg, dict);
    expect(
      issues.some((i) => i.code === 'validate/required-field-missing' && i.refTagID === 1137),
    ).toBe(true);
  });

  it('accepts every ApplVerID(1128) code, and flags one outside the enum', () => {
    const msg = buildValidMessage(dict, '0'); // Heartbeat
    msg.fields[1128] = { tag: 1128, name: 'ApplVerID', raw: '9', value: '9' };
    expect(
      validate(msg, dict).some(
        (i) => i.code === 'validate/value-not-in-enum' && i.refTagID === 1128,
      ),
    ).toBe(false);
    msg.fields[1128] = { tag: 1128, name: 'ApplVerID', raw: '99', value: '99' };
    expect(
      validate(msg, dict).some(
        (i) => i.code === 'validate/value-not-in-enum' && i.refTagID === 1128,
      ),
    ).toBe(true);
  });

  it('flags an out-of-range enum value', () => {
    const msg = buildValidMessage(dict, 'D'); // NewOrderSingle
    msg.fields[54] = { tag: 54, name: 'Side', raw: '~', value: '~' }; // not a valid Side
    const issues = validate(msg, dict);
    expect(issues.some((i) => i.code === 'validate/value-not-in-enum' && i.refTagID === 54)).toBe(
      true,
    );
  });

  it('flags a required field dropped from a required group entry (deep, indexed path)', () => {
    // W (MarketDataSnapshotFullRefresh) requires NoMDEntries(268) entries carrying
    // MDEntryType(269). Drop it from the built entry and assert the indexed path.
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

  it('validates the FIX 5.0 TZ datatypes and flags malformed values', () => {
    // MaturityTime(1079) is TZTimeOnly; put it on a message that allows it via Instrument.
    const field = dict.fieldByTag(1079)!;
    expect(field.type).toBe('TZTimeOnly');
    const msg = buildValidMessage(dict, 'D');
    msg.fields[1079] = {
      tag: 1079,
      name: field.name,
      raw: '12:30:00+02:00',
      value: '12:30:00+02:00',
    };
    expect(
      validate(msg, dict).some((i) => i.code === 'validate/invalid-value' && i.refTagID === 1079),
    ).toBe(false);
    msg.fields[1079] = {
      tag: 1079,
      name: field.name,
      raw: 'half past noon',
      value: 'half past noon',
    };
    expect(
      validate(msg, dict).some((i) => i.code === 'validate/invalid-value' && i.refTagID === 1079),
    ).toBe(true);
  });

  it('validates MultipleCharValue per token', () => {
    // MDQuoteType… use a known MultipleCharValue enum field: MultiLegRptTypeReq? Simplest is
    // TradeCondition(277) — MultipleStringValue in SP2 — and ExecInst(18), MultipleCharValue.
    const execInst = dict.fieldByTag(18)!;
    expect(dict.resolveDatatype(execInst.type)?.multiValueDelimiter).toBe(' ');
    const msg = buildValidMessage(dict, 'D');
    const good = execInst.enumValues![0]!.value;
    msg.fields[18] = {
      tag: 18,
      name: 'ExecInst',
      raw: `${good} ${good === '1' ? '2' : '1'}`,
      value: '',
    };
    expect(
      validate(msg, dict).some((i) => i.code === 'validate/value-not-in-enum' && i.refTagID === 18),
    ).toBe(false);
    msg.fields[18] = { tag: 18, name: 'ExecInst', raw: `${good} ~~`, value: '' };
    expect(
      validate(msg, dict).some((i) => i.code === 'validate/value-not-in-enum' && i.refTagID === 18),
    ).toBe(true);
  });

  it('never throws and returns an array for every message type', () => {
    for (const msgType of MESSAGE_TYPES) {
      const issues = validate(buildValidMessage(dict, msgType), dict);
      expect(Array.isArray(issues)).toBe(true);
    }
  });
});
