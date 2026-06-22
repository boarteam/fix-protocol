import { describe, expect, it } from 'vitest';
import { loadDictionary } from '../dictionary/Dictionary';
import type { DictionaryJSON, FieldDef } from '../dictionary/types';
import { decodeValue } from './datatypes';

function dictOf(): DictionaryJSON {
  return {
    version: 'FIX.4.4',
    beginString: 'FIX.4.4',
    datatypes: {
      int: { name: 'int', base: 'int' },
      Length: { name: 'Length', base: 'int', parent: 'int' },
      SeqNum: { name: 'SeqNum', base: 'int', parent: 'int' },
      NumInGroup: { name: 'NumInGroup', base: 'int', parent: 'int' },
      float: { name: 'float', base: 'float' },
      Price: { name: 'Price', base: 'float', parent: 'float' },
      Qty: { name: 'Qty', base: 'float', parent: 'float' },
      char: { name: 'char', base: 'char' },
      Boolean: { name: 'Boolean', base: 'char', parent: 'char' },
      String: { name: 'String', base: 'String' },
      Currency: { name: 'Currency', base: 'String', parent: 'String' },
      MultipleValueString: {
        name: 'MultipleValueString',
        base: 'String',
        parent: 'String',
        multiValueDelimiter: ' ',
      },
      UTCTimestamp: {
        name: 'UTCTimestamp',
        base: 'String',
        parent: 'String',
        formatPattern: 'YYYYMMDD-HH:MM:SS[.sss]',
      },
      data: { name: 'data', base: 'data', lengthPrefixed: true },
    },
    fields: {
      34: { tag: 34, name: 'MsgSeqNum', type: 'SeqNum' },
      44: { tag: 44, name: 'Price', type: 'Price' },
      53: { tag: 53, name: 'Quantity', type: 'Qty' },
      141: { tag: 141, name: 'ResetSeqNumFlag', type: 'Boolean' },
      54: {
        tag: 54,
        name: 'Side',
        type: 'char',
        enumValues: [{ value: '1', name: 'Buy', description: 'Buy' }],
      },
      15: { tag: 15, name: 'Currency', type: 'Currency' },
      18: {
        tag: 18,
        name: 'ExecInst',
        type: 'MultipleValueString',
        // In real FIX 4.4 every MultipleValueString field is ALSO enumerated per token.
        enumValues: [
          { value: '1', name: 'NotHeld', description: 'Not held' },
          { value: '2', name: 'Work', description: 'Work' },
          { value: '5', name: 'Held', description: 'Held' },
        ],
      },
      52: { tag: 52, name: 'SendingTime', type: 'UTCTimestamp' },
      96: { tag: 96, name: 'RawData', type: 'data', lengthField: 95 },
      98: {
        tag: 98,
        name: 'EncryptMethod',
        type: 'int',
        enumValues: [{ value: '0', name: 'None', description: 'None' }],
      },
      9999: { tag: 9999, name: 'Mystery', type: 'NoSuchType' },
    },
    components: {},
    messages: [],
  };
}

const dict = loadDictionary(dictOf());
const field = (tag: number): FieldDef => dict.fieldByTag(tag)!;
const decode = (raw: string, tag: number) => decodeValue(raw, field(tag), dict);

describe('decodeValue', () => {
  it('coerces int families to numbers, preserving raw for leading zeros', () => {
    expect(decode('42', 34).value).toBe(42);
    expect(decode('00023', 34).value).toBe(23); // typed loses the zeros; raw (kept by parser) does not
    expect(decode('-7', 34).value).toBe(-7);
  });

  it('flags a non-integer int and falls back to the raw string', () => {
    const r = decode('1.5', 34);
    expect(r.value).toBe('1.5');
    expect(r.issues[0]?.code).toBe('parse/invalid-int');
    expect(r.issues[0]?.severity).toBe('error');
  });

  it('keeps an over-large integer as a string with a precision warning', () => {
    const big = '99999999999999999999';
    const r = decode(big, 34);
    expect(r.value).toBe(big);
    expect(r.issues[0]?.code).toBe('parse/number-precision');
    expect(r.issues[0]?.severity).toBe('warning');
  });

  it('coerces float families to numbers and accepts FIX float forms', () => {
    expect(decode('1.5', 44).value).toBe(1.5);
    expect(decode('23.', 44).value).toBe(23);
    expect(decode('.5', 44).value).toBe(0.5);
    expect(decode('00023.230', 44).value).toBe(23.23); // typed is lossy; raw round-trips
    expect(decode('-0.01', 53).value).toBe(-0.01);
  });

  it('flags a malformed float', () => {
    const r = decode('1.2.3', 44);
    expect(r.value).toBe('1.2.3');
    expect(r.issues[0]?.code).toBe('parse/invalid-float');
  });

  it('coerces Boolean Y/N to booleans and flags anything else', () => {
    expect(decode('Y', 141).value).toBe(true);
    expect(decode('N', 141).value).toBe(false);
    const r = decode('X', 141);
    expect(r.value).toBe('X');
    expect(r.issues[0]?.code).toBe('parse/invalid-boolean');
  });

  it('keeps enum-valued fields as opaque strings regardless of base type', () => {
    expect(decode('1', 54)).toEqual({ value: '1', issues: [] }); // char enum
    expect(decode('0', 98)).toEqual({ value: '0', issues: [] }); // int enum stays a string
  });

  it('splits MultipleValueString on its delimiter even when the field is enumerated', () => {
    // Regression: enum opacity must NOT short-circuit the list split (every real FIX 4.4
    // MultipleValueString field carries an enum table).
    expect(decode('1 2 5', 18).value).toEqual(['1', '2', '5']);
    expect(decode('1', 18).value).toEqual(['1']);
  });

  it('does not resolve datatypes via Object.prototype member names', () => {
    // A field whose datatype name collides with a prototype member must miss, not return a
    // bogus inherited function (which would suppress the unknown-datatype warning).
    expect(dict.resolveDatatype('toString')).toBeUndefined();
    expect(dict.datatype('constructor')).toBeUndefined();
    expect(dict.component('valueOf')).toBeUndefined();
  });

  it('leaves String-derived dates and currency codes verbatim', () => {
    expect(decode('20260620-12:00:00.123', 52).value).toBe('20260620-12:00:00.123');
    expect(decode('004', 15).value).toBe('004'); // ISO numeric currency code, not 4
  });

  it('returns data verbatim, even with an embedded separator', () => {
    expect(decode('a\x01b', 96).value).toBe('a\x01b');
  });

  it('warns on an unknown datatype and keeps the raw string', () => {
    const r = decode('whatever', 9999);
    expect(r.value).toBe('whatever');
    expect(r.issues[0]?.code).toBe('parse/unknown-datatype');
  });
});
