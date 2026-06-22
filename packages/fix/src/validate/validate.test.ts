import { describe, expect, it } from 'vitest';
import { type Dictionary, loadDictionary } from '../dictionary/Dictionary';
import type { DictionaryJSON } from '../dictionary/types';
import type { ParsedField, ParsedGroupEntry, ParsedMessage } from '../codec/parse';
import type { ConditionalRule } from './conditions';
import { validate } from './validate';

/**
 * A compact order-shaped dictionary exercising every validator branch: required/optional
 * fields, an enum, a multi-valued enum, a repeating group with a required body field, an
 * optional component with a required inner field (presence gating), a `data`/`Length` pair,
 * and date/currency datatypes.
 */
function orderDict(): DictionaryJSON {
  const enumChar = (tag: number, name: string, values: [string, string][], type = 'char') => ({
    tag,
    name,
    type,
    enumValues: values.map(([value, n]) => ({ value, name: n, description: n })),
  });
  return {
    version: 'FIX.4.4',
    beginString: 'FIX.4.4',
    datatypes: {
      String: { name: 'String', base: 'String' },
      int: { name: 'int', base: 'int' },
      Length: { name: 'Length', base: 'int', parent: 'int' },
      SeqNum: { name: 'SeqNum', base: 'int', parent: 'int' },
      NumInGroup: { name: 'NumInGroup', base: 'int', parent: 'int' },
      char: { name: 'char', base: 'char' },
      Boolean: { name: 'Boolean', base: 'char', parent: 'char' },
      float: { name: 'float', base: 'float' },
      Price: { name: 'Price', base: 'float', parent: 'float' },
      Qty: { name: 'Qty', base: 'float', parent: 'float' },
      Currency: { name: 'Currency', base: 'String', parent: 'String' },
      Country: { name: 'Country', base: 'String', parent: 'String' },
      UTCTimestamp: { name: 'UTCTimestamp', base: 'String', parent: 'String' },
      UTCTimeOnly: { name: 'UTCTimeOnly', base: 'String', parent: 'String' },
      UTCDateOnly: { name: 'UTCDateOnly', base: 'String', parent: 'String' },
      LocalMktDate: { name: 'LocalMktDate', base: 'String', parent: 'String' },
      'month-year': { name: 'month-year', base: 'String', parent: 'String' },
      // A custom datatype derived from UTCTimestamp — exercises chain-based format dispatch.
      MyTimestamp: { name: 'MyTimestamp', base: 'String', parent: 'UTCTimestamp' },
      MultipleValueString: {
        name: 'MultipleValueString',
        base: 'String',
        parent: 'String',
        multiValueDelimiter: ' ',
      },
      data: { name: 'data', base: 'data', lengthPrefixed: true },
    },
    fields: {
      8: { tag: 8, name: 'BeginString', type: 'String' },
      9: { tag: 9, name: 'BodyLength', type: 'Length' },
      35: { tag: 35, name: 'MsgType', type: 'String' },
      49: { tag: 49, name: 'SenderCompID', type: 'String' },
      56: { tag: 56, name: 'TargetCompID', type: 'String' },
      34: { tag: 34, name: 'MsgSeqNum', type: 'SeqNum' },
      52: { tag: 52, name: 'SendingTime', type: 'UTCTimestamp' },
      43: { tag: 43, name: 'PossDupFlag', type: 'Boolean' },
      122: { tag: 122, name: 'OrigSendingTime', type: 'UTCTimestamp' },
      10: { tag: 10, name: 'CheckSum', type: 'String' },
      55: { tag: 55, name: 'Symbol', type: 'String' },
      15: { tag: 15, name: 'Currency', type: 'Currency' },
      44: { tag: 44, name: 'Price', type: 'Price' },
      58: { tag: 58, name: 'Text', type: 'String' },
      54: enumChar(54, 'Side', [
        ['1', 'Buy'],
        ['2', 'Sell'],
      ]),
      18: enumChar(
        18,
        'ExecInst',
        [
          ['1', 'NotHeld'],
          ['2', 'Work'],
          ['5', 'Held'],
        ],
        'MultipleValueString',
      ),
      268: { tag: 268, name: 'NoMDEntries', type: 'NumInGroup', isGroupCounter: true },
      269: enumChar(269, 'MDEntryType', [
        ['0', 'Bid'],
        ['1', 'Offer'],
      ]),
      270: { tag: 270, name: 'MDEntryPx', type: 'Price' },
      447: enumChar(447, 'PartyIDSource', [
        ['B', 'BIC'],
        ['C', 'Generic'],
      ]),
      448: { tag: 448, name: 'PartyID', type: 'String' },
      95: { tag: 95, name: 'RawDataLength', type: 'Length' },
      96: { tag: 96, name: 'RawData', type: 'data', lengthField: 95 },
      // Format-branch coverage fields (all optional in the Order message).
      110: { tag: 110, name: 'MinQty', type: 'int' },
      204: { tag: 204, name: 'CoveredOrUncovered', type: 'char' },
      575: enumChar(
        575,
        'OddLot',
        [
          ['Y', 'Yes'],
          ['N', 'No'],
        ],
        'Boolean',
      ),
      200: { tag: 200, name: 'MaturityMonthYear', type: 'month-year' },
      421: { tag: 421, name: 'Country', type: 'Country' },
      432: { tag: 432, name: 'ExpireDate', type: 'LocalMktDate' },
      272: { tag: 272, name: 'MDEntryDate', type: 'UTCDateOnly' },
      273: { tag: 273, name: 'MDEntryTime', type: 'UTCTimeOnly' },
      7000: { tag: 7000, name: 'CustomTime', type: 'MyTimestamp' },
      // A second optional component carrying an optional group, for empty-group gating.
      454: { tag: 454, name: 'NoSecurityAltID', type: 'NumInGroup', isGroupCounter: true },
      455: { tag: 455, name: 'SecurityAltID', type: 'String' },
    },
    components: {
      'Standard Message Header': {
        name: 'Standard Message Header',
        members: [
          { kind: 'field', tag: 8, reqd: 'Y' },
          { kind: 'field', tag: 9, reqd: 'Y' },
          { kind: 'field', tag: 35, reqd: 'Y' },
          { kind: 'field', tag: 49, reqd: 'Y' },
          { kind: 'field', tag: 56, reqd: 'Y' },
          { kind: 'field', tag: 34, reqd: 'Y' },
          { kind: 'field', tag: 52, reqd: 'Y' },
          { kind: 'field', tag: 43, reqd: 'N' },
          { kind: 'field', tag: 122, reqd: 'N' },
        ],
      },
      'Standard Message Trailer': {
        name: 'Standard Message Trailer',
        members: [{ kind: 'field', tag: 10, reqd: 'Y' }],
      },
      // Optional component carrying a required inner field — exercises presence gating.
      Parties: {
        name: 'Parties',
        members: [
          { kind: 'field', tag: 448, reqd: 'Y' },
          { kind: 'field', tag: 447, reqd: 'N' },
        ],
      },
      // Optional component whose presence can be signalled by an (optional) group — exercises
      // the empty-group-counter gating regression.
      AltBlock: {
        name: 'AltBlock',
        members: [
          { kind: 'field', tag: 448, reqd: 'Y' },
          {
            kind: 'group',
            counterTag: 454,
            reqd: 'N',
            members: [{ kind: 'field', tag: 455, reqd: 'N' }],
          },
        ],
      },
    },
    messages: [
      {
        name: 'Order',
        msgType: 'D',
        category: 'app',
        members: [
          { kind: 'component', name: 'Standard Message Header', reqd: 'Y' },
          { kind: 'field', tag: 55, reqd: 'Y' },
          { kind: 'field', tag: 54, reqd: 'Y' },
          { kind: 'field', tag: 44, reqd: 'N' },
          { kind: 'field', tag: 15, reqd: 'N' },
          { kind: 'field', tag: 58, reqd: 'N' },
          { kind: 'field', tag: 18, reqd: 'N' },
          { kind: 'component', name: 'Parties', reqd: 'N' },
          {
            kind: 'group',
            counterTag: 268,
            reqd: 'N',
            members: [
              { kind: 'field', tag: 269, reqd: 'Y' },
              { kind: 'field', tag: 270, reqd: 'N' },
            ],
          },
          { kind: 'field', tag: 95, reqd: 'N' },
          { kind: 'field', tag: 96, reqd: 'N' },
          { kind: 'component', name: 'Standard Message Trailer', reqd: 'Y' },
        ],
      },
      {
        name: 'GroupMsg',
        msgType: 'G',
        category: 'app',
        members: [
          { kind: 'component', name: 'Standard Message Header', reqd: 'Y' },
          {
            kind: 'group',
            counterTag: 268,
            reqd: 'Y',
            members: [
              { kind: 'field', tag: 269, reqd: 'Y' },
              { kind: 'field', tag: 270, reqd: 'N' },
            ],
          },
          { kind: 'component', name: 'AltBlock', reqd: 'N' },
          { kind: 'component', name: 'Standard Message Trailer', reqd: 'Y' },
        ],
      },
    ],
  };
}

const dict = loadDictionary(orderDict());

/** Build a `ParsedField` for a tag/value pair, naming it from the dictionary. */
function pf(d: Dictionary, tag: number, raw: string): ParsedField {
  return { tag, name: d.fieldByTag(tag)?.name, raw, value: raw };
}

function entry(
  d: Dictionary,
  fields: Record<number, string>,
  groups: Record<number, ParsedGroupEntry[]> = {},
): ParsedGroupEntry {
  const f: Record<number, ParsedField> = {};
  for (const [tag, raw] of Object.entries(fields)) {
    f[Number(tag)] = pf(d, Number(tag), raw);
  }
  return { fields: f, groups };
}

/** Build a `ParsedMessage` from a flat tag→value map (and optional groups). */
function pm(
  d: Dictionary,
  msgType: string,
  fields: Record<number, string>,
  groups: Record<number, ParsedGroupEntry[]> = {},
): ParsedMessage {
  const e = entry(d, fields, groups);
  return {
    msgType,
    name: d.messageByMsgType(msgType)?.name,
    framed: true,
    fields: e.fields,
    groups: e.groups,
  };
}

/** A conformant standard header + trailer for the given message type. */
function validHeader(msgType: string): Record<number, string> {
  return {
    8: 'FIX.4.4',
    9: '100',
    35: msgType,
    49: 'SENDER',
    56: 'TARGET',
    34: '1',
    52: '20240115-12:30:00.000',
    10: '000',
  };
}

/** A complete, conformant header + required body for the `Order` message. */
function validOrderFields(): Record<number, string> {
  return { ...validHeader('D'), 55: 'AAPL', 54: '1' };
}

function codes(issues: { code: string }[]): string[] {
  return issues.map((i) => i.code);
}

describe('validate — presence', () => {
  it('passes a complete, conformant message', () => {
    const issues = validate(pm(dict, 'D', validOrderFields()), dict);
    expect(issues).toEqual([]);
  });

  it('flags a missing required field', () => {
    const fields = validOrderFields();
    delete fields[55]; // Symbol (required)
    const issues = validate(pm(dict, 'D', fields), dict);
    expect(codes(issues)).toContain('validate/required-field-missing');
    const sym = issues.find((i) => i.refTagID === 55);
    expect(sym?.severity).toBe('error');
    expect(sym?.sessionRejectReason).toBe(1);
    expect(sym?.path).toBe('Symbol');
  });

  it('flags a missing required header field', () => {
    const fields = validOrderFields();
    delete fields[49]; // SenderCompID (required, via header component)
    const issues = validate(pm(dict, 'D', fields), dict);
    expect(
      issues.some((i) => i.code === 'validate/required-field-missing' && i.refTagID === 49),
    ).toBe(true);
  });

  it('does not require fields of an absent optional component', () => {
    // Parties is optional and absent: its required PartyID (448) must NOT be flagged.
    const issues = validate(pm(dict, 'D', validOrderFields()), dict);
    expect(issues.some((i) => i.refTagID === 448)).toBe(false);
  });

  it('requires the required inner field once an optional component is present', () => {
    const fields = { ...validOrderFields(), 447: 'B' }; // PartyIDSource present, PartyID absent
    const issues = validate(pm(dict, 'D', fields), dict);
    expect(
      issues.some((i) => i.code === 'validate/required-field-missing' && i.refTagID === 448),
    ).toBe(true);
  });
});

describe('validate — repeating groups', () => {
  it('passes a group whose entries carry their required body field', () => {
    const groups = {
      268: [entry(dict, { 269: '0', 270: '1.5' }), entry(dict, { 269: '1' })],
    };
    const issues = validate(pm(dict, 'D', validOrderFields(), groups), dict);
    expect(issues).toEqual([]);
  });

  it('flags a required field missing from a group entry, with an indexed path', () => {
    const groups = {
      268: [entry(dict, { 269: '0' }), entry(dict, { 270: '2.0' })], // 2nd entry lacks 269
    };
    const issues = validate(pm(dict, 'D', validOrderFields(), groups), dict);
    const miss = issues.find((i) => i.refTagID === 269);
    expect(miss?.code).toBe('validate/required-field-missing');
    expect(miss?.path).toBe('NoMDEntries[1].MDEntryType');
  });

  it('validates enum membership inside group entries', () => {
    const groups = { 268: [entry(dict, { 269: '9' })] }; // 9 is not a valid MDEntryType
    const issues = validate(pm(dict, 'D', validOrderFields(), groups), dict);
    const bad = issues.find((i) => i.refTagID === 269 && i.code === 'validate/value-not-in-enum');
    expect(bad?.path).toBe('NoMDEntries[0].MDEntryType');
  });
});

describe('validate — enums and values', () => {
  it('flags an out-of-range enum value', () => {
    const fields = { ...validOrderFields(), 54: '9' }; // Side 9 is invalid
    const issues = validate(pm(dict, 'D', fields), dict);
    const bad = issues.find((i) => i.refTagID === 54);
    expect(bad?.code).toBe('validate/value-not-in-enum');
    expect(bad?.sessionRejectReason).toBe(5);
  });

  it('accepts a valid multi-valued enum and flags a bad token', () => {
    expect(validate(pm(dict, 'D', { ...validOrderFields(), 18: '1 5' }), dict)).toEqual([]);
    const issues = validate(pm(dict, 'D', { ...validOrderFields(), 18: '1 9' }), dict);
    const bad = issues.find((i) => i.refTagID === 18);
    expect(bad?.code).toBe('validate/value-not-in-enum');
    expect(bad?.path).toBe('ExecInst[1]'); // the bad token's index
  });

  it('flags a present-but-empty value', () => {
    const issues = validate(pm(dict, 'D', { ...validOrderFields(), 58: '' }), dict);
    const empty = issues.find((i) => i.refTagID === 58);
    expect(empty?.code).toBe('validate/empty-value');
    expect(empty?.sessionRejectReason).toBe(4);
  });
});

describe('validate — datatype format', () => {
  it('flags a malformed price (float)', () => {
    const issues = validate(pm(dict, 'D', { ...validOrderFields(), 44: 'abc' }), dict);
    const bad = issues.find((i) => i.refTagID === 44);
    expect(bad?.code).toBe('validate/invalid-value');
    expect(bad?.sessionRejectReason).toBe(6);
  });

  it('flags a malformed UTCTimestamp', () => {
    const issues = validate(pm(dict, 'D', { ...validOrderFields(), 52: '2024-01-15 12:30' }), dict);
    expect(issues.some((i) => i.refTagID === 52 && i.code === 'validate/invalid-value')).toBe(true);
  });

  it('accepts sub-millisecond timestamp precision', () => {
    const issues = validate(
      pm(dict, 'D', { ...validOrderFields(), 52: '20240115-12:30:00.123456' }),
      dict,
    );
    expect(issues).toEqual([]);
  });

  it('warns (not errors) on a non-ISO currency', () => {
    const issues = validate(pm(dict, 'D', { ...validOrderFields(), 15: 'US' }), dict);
    const cur = issues.find((i) => i.refTagID === 15);
    expect(cur?.code).toBe('validate/invalid-value');
    expect(cur?.severity).toBe('warning');
  });

  it('accepts a valid currency', () => {
    expect(validate(pm(dict, 'D', { ...validOrderFields(), 15: 'USD' }), dict)).toEqual([]);
  });
});

describe('validate — conditional rules', () => {
  it('requires the Length companion of a present data field', () => {
    // RawData present without RawDataLength (95).
    const issues = validate(pm(dict, 'D', { ...validOrderFields(), 96: 'CAFE' }), dict);
    const cond = issues.find((i) => i.refTagID === 95);
    expect(cond?.code).toBe('validate/conditional-required');
    expect(cond?.sessionRejectReason).toBe(21);
  });

  it('accepts a data field with its Length companion', () => {
    const issues = validate(pm(dict, 'D', { ...validOrderFields(), 95: '4', 96: 'CAFE' }), dict);
    expect(issues).toEqual([]);
  });

  it('requires OrigSendingTime when PossDupFlag is Y', () => {
    const issues = validate(pm(dict, 'D', { ...validOrderFields(), 43: 'Y' }), dict);
    const cond = issues.find((i) => i.refTagID === 122);
    expect(cond?.code).toBe('validate/conditional-required');
  });

  it('accepts PossDupFlag=Y with OrigSendingTime present', () => {
    const issues = validate(
      pm(dict, 'D', { ...validOrderFields(), 43: 'Y', 122: '20240115-12:29:00.000' }),
      dict,
    );
    expect(issues).toEqual([]);
  });

  it('honours a caller-supplied conditional rule', () => {
    const rule: ConditionalRule = (ctx) =>
      ctx.has(54) && ctx.field(54) === '1' && !ctx.has(44)
        ? [
            {
              code: 'validate/conditional-required',
              severity: 'error',
              message: 'Price required for buys',
              refTagID: 44,
            },
          ]
        : [];
    const issues = validate(pm(dict, 'D', validOrderFields()), dict, { conditionalRules: [rule] });
    expect(
      issues.some((i) => i.refTagID === 44 && i.code === 'validate/conditional-required'),
    ).toBe(true);
  });

  it('can disable the built-in conditional rules', () => {
    const issues = validate(pm(dict, 'D', { ...validOrderFields(), 43: 'Y' }), dict, {
      useDefaultConditionalRules: false,
    });
    expect(issues.some((i) => i.refTagID === 122)).toBe(false);
  });

  it('isolates a throwing custom rule and keeps the others (never throws)', () => {
    const boom: ConditionalRule = () => {
      throw new Error('boom');
    };
    const good: ConditionalRule = () => [
      {
        code: 'validate/conditional-required',
        severity: 'error',
        message: 'from good',
        refTagID: 1,
      },
    ];
    let issues!: ReturnType<typeof validate>;
    expect(() => {
      issues = validate(pm(dict, 'D', validOrderFields()), dict, {
        conditionalRules: [boom, good],
      });
    }).not.toThrow();
    // The well-behaved rule still ran despite the throwing one.
    expect(issues.some((i) => i.refTagID === 1)).toBe(true);
  });

  it('ignores a rule that returns a non-array (never throws)', () => {
    const broken = (() => 'not an array') as unknown as ConditionalRule;
    expect(() =>
      validate(pm(dict, 'D', validOrderFields()), dict, { conditionalRules: [broken] }),
    ).not.toThrow();
  });
});

describe('validate — unknown / flat messages', () => {
  it('reports an unknown MsgType and skips presence', () => {
    const msg = pm(dict, 'ZZ', { ...validOrderFields(), 35: 'ZZ' });
    const issues = validate(msg, dict);
    expect(codes(issues)).toContain('validate/unknown-msgtype');
    // No presence errors are produced without a definition.
    expect(issues.some((i) => i.code.startsWith('validate/required'))).toBe(false);
  });

  it('still value-checks fields of an unknown-MsgType message', () => {
    const msg = pm(dict, 'ZZ', { 35: 'ZZ', 54: '9' }); // bad Side enum
    const issues = validate(msg, dict);
    expect(issues.some((i) => i.refTagID === 54 && i.code === 'validate/value-not-in-enum')).toBe(
      true,
    );
  });

  it('reports a missing MsgType', () => {
    const msg: ParsedMessage = { msgType: '', framed: false, fields: {}, groups: {} };
    const issues = validate(msg, dict);
    expect(codes(issues)).toContain('validate/unknown-msgtype');
  });

  it('never throws on an empty message', () => {
    expect(() =>
      validate({ msgType: '', framed: false, fields: {}, groups: {} }, dict),
    ).not.toThrow();
  });
});

describe('validate — required groups (presence)', () => {
  const goodGroup = { 268: [entry(dict, { 269: '0' })] };

  it('flags a missing required group', () => {
    const issues = validate(pm(dict, 'G', validHeader('G')), dict);
    const miss = issues.find((i) => i.refTagID === 268);
    expect(miss?.code).toBe('validate/required-group-missing');
    expect(miss?.path).toBe('NoMDEntries');
    expect(miss?.sessionRejectReason).toBe(1);
  });

  it('flags a present-but-empty required group (NoXxx=0)', () => {
    const issues = validate(pm(dict, 'G', validHeader('G'), { 268: [] }), dict);
    expect(
      issues.some((i) => i.code === 'validate/required-group-missing' && i.refTagID === 268),
    ).toBe(true);
  });

  it('accepts a required group with at least one entry', () => {
    const issues = validate(pm(dict, 'G', validHeader('G'), goodGroup), dict);
    expect(issues).toEqual([]);
  });

  it('does not activate an optional component on an empty group counter (regression)', () => {
    // AltBlock (optional) requires PartyID(448); an empty NoSecurityAltID(454) group must NOT
    // make AltBlock "present", so 448 stays optional.
    const issues = validate(pm(dict, 'G', validHeader('G'), { ...goodGroup, 454: [] }), dict);
    expect(issues.some((i) => i.refTagID === 448)).toBe(false);
  });

  it('activates an optional component when its group has a real entry', () => {
    const issues = validate(
      pm(dict, 'G', validHeader('G'), {
        ...goodGroup,
        454: [entry(dict, { 455: 'X' })], // group present → AltBlock active → 448 required
      }),
      dict,
    );
    expect(
      issues.some((i) => i.code === 'validate/required-field-missing' && i.refTagID === 448),
    ).toBe(true);
  });
});

describe('validate — datatype format branches', () => {
  const bad = (tag: number, value: string) =>
    validate(pm(dict, 'D', { ...validOrderFields(), [tag]: value }), dict).find(
      (i) => i.refTagID === tag,
    );

  it('flags a malformed int', () => {
    expect(bad(110, '12.5')?.code).toBe('validate/invalid-value');
  });

  it('flags a multi-character char', () => {
    expect(bad(204, 'AB')?.code).toBe('validate/invalid-value');
    expect(validate(pm(dict, 'D', { ...validOrderFields(), 204: 'A' }), dict)).toEqual([]);
  });

  it('flags a non-Y/N Boolean with invalid-value, not value-not-in-enum (regression)', () => {
    // OddLot(575) is a Boolean that also lists Y/N as enum values.
    const issue575 = bad(575, 'X');
    expect(issue575?.code).toBe('validate/invalid-value');
    expect(issue575?.sessionRejectReason).toBe(6);
    expect(validate(pm(dict, 'D', { ...validOrderFields(), 575: 'Y' }), dict)).toEqual([]);
  });

  it('flags malformed UTCTimeOnly / UTCDateOnly / LocalMktDate', () => {
    expect(bad(273, '12:30')?.code).toBe('validate/invalid-value');
    expect(bad(272, '2024-01-15')?.code).toBe('validate/invalid-value');
    expect(bad(432, '15/01/2024')?.code).toBe('validate/invalid-value');
    expect(
      validate(
        pm(dict, 'D', { ...validOrderFields(), 273: '12:30:00', 272: '20240115', 432: '20240115' }),
        dict,
      ),
    ).toEqual([]);
  });

  it('warns (not errors) on a non-ISO country', () => {
    const c = bad(421, 'USA');
    expect(c?.code).toBe('validate/invalid-value');
    expect(c?.severity).toBe('warning');
    expect(validate(pm(dict, 'D', { ...validOrderFields(), 421: 'US' }), dict)).toEqual([]);
  });

  it('format-checks a datatype derived from UTCTimestamp (regression)', () => {
    // CustomTime(7000) has datatype MyTimestamp whose parent is UTCTimestamp.
    expect(bad(7000, 'not-a-time')?.code).toBe('validate/invalid-value');
    expect(
      validate(pm(dict, 'D', { ...validOrderFields(), 7000: '20240115-12:30:00' }), dict),
    ).toEqual([]);
  });
});

describe('validate — month-year format', () => {
  const my = (value: string) =>
    validate(pm(dict, 'D', { ...validOrderFields(), 200: value }), dict).find(
      (i) => i.refTagID === 200,
    );

  it('accepts YYYYMM, YYYYMMDD, and YYYYMMwWW', () => {
    expect(my('202401')).toBeUndefined();
    expect(my('20240115')).toBeUndefined();
    expect(my('202401w3')).toBeUndefined();
  });

  it('rejects malformed, out-of-range, and uppercase-week month-year', () => {
    expect(my('2024')?.code).toBe('validate/invalid-value'); // too short
    expect(my('202413')?.code).toBe('validate/invalid-value'); // month 13
    expect(my('20240145')?.code).toBe('validate/invalid-value'); // day 45
    expect(my('202401W3')?.code).toBe('validate/invalid-value'); // uppercase week marker
  });
});

describe('validate — safety on untrusted dictionaries', () => {
  function baseShape(extra: Partial<DictionaryJSON>): DictionaryJSON {
    return {
      version: 'FIX.4.4',
      beginString: 'FIX.4.4',
      datatypes: { String: { name: 'String', base: 'String' } },
      fields: {
        35: { tag: 35, name: 'MsgType', type: 'String' },
        99: { tag: 99, name: 'Inner', type: 'String' },
      },
      components: {},
      messages: [],
      ...extra,
    };
  }

  it('terminates on a self-referential component without throwing', () => {
    const json = baseShape({
      components: {
        Loop: {
          name: 'Loop',
          members: [
            { kind: 'field', tag: 99, reqd: 'Y' },
            { kind: 'component', name: 'Loop', reqd: 'N' },
          ],
        },
      },
      messages: [
        {
          name: 'M',
          msgType: 'M',
          category: 'app',
          members: [{ kind: 'component', name: 'Loop', reqd: 'Y' }],
        },
      ],
    });
    const d = loadDictionary(json);
    let issues!: ReturnType<typeof validate>;
    expect(() => {
      issues = validate({ msgType: 'M', framed: true, fields: {}, groups: {} }, d);
    }).not.toThrow();
    expect(
      issues.some((i) => i.code === 'validate/required-field-missing' && i.refTagID === 99),
    ).toBe(true);
  });

  it('terminates on mutually-referential components', () => {
    const json = baseShape({
      components: {
        A: { name: 'A', members: [{ kind: 'component', name: 'B', reqd: 'N' }] },
        B: { name: 'B', members: [{ kind: 'component', name: 'A', reqd: 'N' }] },
      },
      messages: [
        {
          name: 'M',
          msgType: 'M',
          category: 'app',
          members: [{ kind: 'component', name: 'A', reqd: 'Y' }],
        },
      ],
    });
    const d = loadDictionary(json);
    expect(() => validate({ msgType: 'M', framed: true, fields: {}, groups: {} }, d)).not.toThrow();
  });

  it('resolves a component named like an Object.prototype member to a miss', () => {
    const json = baseShape({
      messages: [
        {
          name: 'M',
          msgType: 'M',
          category: 'app',
          members: [{ kind: 'component', name: 'toString', reqd: 'Y' }],
        },
      ],
    });
    const d = loadDictionary(json);
    expect(() => validate({ msgType: 'M', framed: true, fields: {}, groups: {} }, d)).not.toThrow();
  });

  it('does not overflow the stack on a deeply nested acyclic component chain', () => {
    const components: DictionaryJSON['components'] = {};
    const depth = 5000;
    for (let i = 0; i < depth; i++) {
      components[`C${i}`] = {
        name: `C${i}`,
        members: [{ kind: 'component', name: `C${i + 1}`, reqd: 'Y' }],
      };
    }
    components[`C${depth}`] = {
      name: `C${depth}`,
      members: [{ kind: 'field', tag: 99, reqd: 'Y' }],
    };
    const json = baseShape({
      components,
      messages: [
        {
          name: 'M',
          msgType: 'M',
          category: 'app',
          members: [{ kind: 'component', name: 'C0', reqd: 'Y' }],
        },
      ],
    });
    const d = loadDictionary(json);
    expect(() => validate({ msgType: 'M', framed: true, fields: {}, groups: {} }, d)).not.toThrow();
  });
});
