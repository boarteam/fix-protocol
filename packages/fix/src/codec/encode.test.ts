import { describe, expect, it } from 'vitest';
import { loadDictionary } from '../dictionary/Dictionary';
import type { DictionaryJSON } from '../dictionary/types';
import { calculateChecksum } from './checksum';
import { encode } from './encode';
import { SOH, tokenize } from './tokenize';

const show = (s: string) => s.replace(/\x01/g, '|');

/**
 * A minimal FIX.4.4-shaped dictionary: enough header/trailer + a market-data-style group
 * to exercise ordered emission, component expansion, and repeating groups without pulling
 * in the full generated dictionary.
 */
function tinyDict(): DictionaryJSON {
  const f = (tag: number, name: string, type: string, isGroupCounter = false) => ({
    tag,
    name,
    type,
    ...(isGroupCounter ? { isGroupCounter: true } : {}),
  });
  return {
    version: 'FIX.4.4',
    beginString: 'FIX.4.4',
    datatypes: {
      String: { name: 'String', base: 'String' },
      int: { name: 'int', base: 'int' },
      char: { name: 'char', base: 'char' },
      NumInGroup: { name: 'NumInGroup', base: 'int', parent: 'int' },
    },
    fields: {
      8: f(8, 'BeginString', 'String'),
      9: f(9, 'BodyLength', 'int'),
      35: f(35, 'MsgType', 'String'),
      49: f(49, 'SenderCompID', 'String'),
      56: f(56, 'TargetCompID', 'String'),
      34: f(34, 'MsgSeqNum', 'int'),
      52: f(52, 'SendingTime', 'String'),
      10: f(10, 'CheckSum', 'String'),
      98: f(98, 'EncryptMethod', 'int'),
      108: f(108, 'HeartBtInt', 'int'),
      58: f(58, 'Text', 'String'),
      267: f(267, 'NoMDEntryTypes', 'NumInGroup', true),
      269: f(269, 'MDEntryType', 'char'),
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
        ],
      },
      'Standard Message Trailer': {
        name: 'Standard Message Trailer',
        members: [{ kind: 'field', tag: 10, reqd: 'Y' }],
      },
    },
    messages: [
      {
        name: 'Logon',
        msgType: 'A',
        category: 'admin',
        members: [
          { kind: 'component', name: 'Standard Message Header', reqd: 'Y' },
          { kind: 'field', tag: 98, reqd: 'Y' },
          { kind: 'field', tag: 108, reqd: 'Y' },
          { kind: 'component', name: 'Standard Message Trailer', reqd: 'Y' },
        ],
      },
      {
        name: 'MarketDataRequest',
        msgType: 'V',
        category: 'app',
        members: [
          { kind: 'component', name: 'Standard Message Header', reqd: 'Y' },
          {
            kind: 'group',
            counterTag: 267,
            reqd: 'Y',
            members: [{ kind: 'field', tag: 269, reqd: 'Y' }],
          },
          { kind: 'field', tag: 58, reqd: 'N' },
          { kind: 'component', name: 'Standard Message Trailer', reqd: 'Y' },
        ],
      },
    ],
  };
}

const dict = loadDictionary(tinyDict());

describe('encode', () => {
  it('emits fields in dictionary order, with framing first and checksum last', () => {
    const out = encode(
      {
        msgType: 'A',
        fields: { 49: 'CLIENT', 56: 'SERVER', 34: 1, 52: '20260620-12:00:00', 98: 0, 108: 30 },
      },
      dict,
    );
    expect(show(out)).toBe(
      '8=FIX.4.4|9=63|35=A|49=CLIENT|56=SERVER|34=1|52=20260620-12:00:00|98=0|108=30|10=188|',
    );
  });

  it('produces a self-consistent BodyLength and CheckSum', () => {
    const out = encode(
      { msgType: 'A', fields: { 49: 'A', 56: 'B', 34: 1, 52: 'T', 98: 0, 108: 30 } },
      dict,
    );
    const tokens = tokenize(out);
    const bodyLen = Number(tokens.find(([t]) => t === 9)![1]);
    const checksum = tokens.find(([t]) => t === 10)![1];

    // BodyLength counts bytes from after 9's SOH up to and including the SOH before 10.
    const ix9End = out.indexOf(SOH, out.indexOf('9=')) + 1;
    const ix10 = out.lastIndexOf(`${SOH}10=`) + 1;
    expect(bodyLen).toBe(ix10 - ix9End);

    // CheckSum covers everything up to and including the SOH before 10.
    expect(calculateChecksum(out.slice(0, ix10))).toBe(checksum);
  });

  it('does not emit caller-supplied framing tags (8/9/10) or trust an explicit 35', () => {
    const out = encode(
      {
        msgType: 'A',
        fields: {
          8: 'BOGUS',
          9: 999,
          10: '000',
          35: 'X',
          49: 'A',
          56: 'B',
          34: 1,
          52: 'T',
          98: 0,
          108: 30,
        },
      },
      dict,
    );
    expect(out.startsWith('8=FIX.4.4')).toBe(true);
    expect(show(out)).toContain('|35=A|'); // from msgType, not the bogus 35=X
    expect(show(out)).not.toContain('BOGUS');
    expect((show(out).match(/\|10=/g) || []).length).toBe(1);
  });

  it('emits a repeating group as count followed by ordered entries', () => {
    const out = encode(
      {
        msgType: 'V',
        fields: { 49: 'A', 56: 'B', 34: 1, 52: 'T' },
        groups: { 267: [{ fields: { 269: '0' } }, { fields: { 269: '1' } }] },
      },
      dict,
    );
    expect(show(out)).toContain('|267=2|269=0|269=1|');
  });

  it('omits an absent optional field and an empty group', () => {
    const out = encode({ msgType: 'V', fields: { 49: 'A', 56: 'B', 34: 1, 52: 'T' } }, dict);
    expect(show(out)).not.toContain('|58=');
    expect(show(out)).not.toContain('|267=');
  });

  it('maps booleans to Y/N', () => {
    const out = encode(
      { msgType: 'A', fields: { 49: 'A', 56: 'B', 34: 1, 52: 'T', 98: 0, 108: true } },
      dict,
    );
    expect(show(out)).toContain('|108=Y|');
  });

  it('is byte-accurate for non-ASCII values', () => {
    const out = encode(
      { msgType: 'V', fields: { 49: 'A', 56: 'B', 34: 1, 52: 'T', 58: 'Müller' } },
      dict,
    );
    const tokens = tokenize(out);
    const bodyLen = Number(tokens.find(([t]) => t === 9)![1]);
    const ix9End = out.indexOf(SOH, out.indexOf('9=')) + 1;
    const ix10 = out.lastIndexOf(`${SOH}10=`) + 1;
    // The 'ü' is two UTF-8 bytes, so the byte body length exceeds the JS string slice length.
    expect(bodyLen).toBe(new TextEncoder().encode(out.slice(ix9End, ix10)).length);
    expect(bodyLen).toBeGreaterThan(ix10 - ix9End);
  });

  it('throws on an unknown MsgType', () => {
    expect(() => encode({ msgType: 'ZZ' }, dict)).toThrow(/unknown MsgType/);
  });

  it('rejects numbers that would render as invalid FIX values', () => {
    const base = { 49: 'A', 56: 'B', 34: 1, 52: 'T', 98: 0 };
    expect(() => encode({ msgType: 'A', fields: { ...base, 108: Number.NaN } }, dict)).toThrow(
      /non-finite/,
    );
    expect(() => encode({ msgType: 'A', fields: { ...base, 108: Infinity } }, dict)).toThrow(
      /non-finite/,
    );
    expect(() => encode({ msgType: 'A', fields: { ...base, 108: 1e21 } }, dict)).toThrow(
      /exponent/,
    );
  });
});

describe('Dictionary group/tag resolution', () => {
  it('resolves the group delimiter through a leading field', () => {
    const v = dict.messageByMsgType('V')!;
    const group = v.members.find((m) => m.kind === 'group')!;
    expect(group.kind).toBe('group');
    if (group.kind === 'group') {
      expect(dict.groupDelimiterTag(group)).toBe(269);
    }
  });

  it('collects allowed tags across components and groups', () => {
    const allowed = dict.allowedTags('V');
    expect(allowed.has(8)).toBe(true); // from header component
    expect(allowed.has(267)).toBe(true); // group counter
    expect(allowed.has(269)).toBe(true); // group member
    expect(allowed.has(10)).toBe(true); // from trailer component
    expect(allowed.has(999)).toBe(false);
  });
});

describe('encode -> tokenize round-trip', () => {
  it('reproduces the exact ordered field/group emission', () => {
    const out = encode(
      {
        msgType: 'V',
        fields: { 49: 'CLIENT', 56: 'SERVER', 34: 7, 52: 'T', 58: 'hi' },
        groups: { 267: [{ fields: { 269: '0' } }, { fields: { 269: '1' } }] },
      },
      dict,
    );
    const body = tokenize(out).filter(([t]) => ![8, 9, 10, 35].includes(t));
    expect(body).toEqual([
      [49, 'CLIENT'],
      [56, 'SERVER'],
      [34, '7'],
      [52, 'T'],
      [267, '2'],
      [269, '0'],
      [269, '1'],
      [58, 'hi'],
    ]);
  });
});

describe('encode nested repeating groups', () => {
  // NoSides(552) entries, each with a Side(54) and a nested NoPartyIDs(453) -> PartyID(448).
  const nestedDict = loadDictionary({
    version: 'FIX.4.4',
    beginString: 'FIX.4.4',
    datatypes: {
      String: { name: 'String', base: 'String' },
      int: { name: 'int', base: 'int' },
      char: { name: 'char', base: 'char' },
      NumInGroup: { name: 'NumInGroup', base: 'int', parent: 'int' },
    },
    fields: {
      8: { tag: 8, name: 'BeginString', type: 'String' },
      9: { tag: 9, name: 'BodyLength', type: 'int' },
      35: { tag: 35, name: 'MsgType', type: 'String' },
      49: { tag: 49, name: 'SenderCompID', type: 'String' },
      56: { tag: 56, name: 'TargetCompID', type: 'String' },
      10: { tag: 10, name: 'CheckSum', type: 'String' },
      54: { tag: 54, name: 'Side', type: 'char' },
      448: { tag: 448, name: 'PartyID', type: 'String' },
      552: { tag: 552, name: 'NoSides', type: 'NumInGroup', isGroupCounter: true },
      453: { tag: 453, name: 'NoPartyIDs', type: 'NumInGroup', isGroupCounter: true },
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
        ],
      },
      'Standard Message Trailer': {
        name: 'Standard Message Trailer',
        members: [{ kind: 'field', tag: 10, reqd: 'Y' }],
      },
    },
    messages: [
      {
        name: 'NewOrderCross',
        msgType: 's',
        category: 'app',
        members: [
          { kind: 'component', name: 'Standard Message Header', reqd: 'Y' },
          {
            kind: 'group',
            counterTag: 552,
            reqd: 'Y',
            members: [
              { kind: 'field', tag: 54, reqd: 'Y' },
              {
                kind: 'group',
                counterTag: 453,
                reqd: 'N',
                members: [{ kind: 'field', tag: 448, reqd: 'Y' }],
              },
            ],
          },
          { kind: 'component', name: 'Standard Message Trailer', reqd: 'Y' },
        ],
      },
    ],
  });

  it('emits a group-within-a-group entry in order', () => {
    const out = encode(
      {
        msgType: 's',
        fields: { 49: 'A', 56: 'B' },
        groups: {
          552: [
            {
              fields: { 54: '1' },
              groups: { 453: [{ fields: { 448: 'P1' } }, { fields: { 448: 'P2' } }] },
            },
            { fields: { 54: '2' } },
          ],
        },
      },
      nestedDict,
    );
    const body = tokenize(out).filter(([t]) => ![8, 9, 10, 35].includes(t));
    expect(body).toEqual([
      [49, 'A'],
      [56, 'B'],
      [552, '2'],
      [54, '1'],
      [453, '2'],
      [448, 'P1'],
      [448, 'P2'],
      [54, '2'], // second NoSides entry: nested group omitted (absent), Side still emitted
    ]);
  });

  it('is byte-accurate when a multi-byte value sits inside a group entry', () => {
    const out = encode(
      { msgType: 's', fields: { 49: 'A', 56: 'B' }, groups: { 552: [{ fields: { 54: 'ü' } }] } },
      nestedDict,
    );
    const bodyLen = Number(tokenize(out).find(([t]) => t === 9)![1]);
    const ix9End = out.indexOf(SOH, out.indexOf('9=')) + 1;
    const ix10 = out.lastIndexOf(`${SOH}10=`) + 1;
    expect(bodyLen).toBe(new TextEncoder().encode(out.slice(ix9End, ix10)).length);
    expect(bodyLen).toBeGreaterThan(ix10 - ix9End); // 'ü' is two UTF-8 bytes
  });
});
