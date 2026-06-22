import { describe, expect, it } from 'vitest';
import { loadDictionary } from '../dictionary/Dictionary';
import type { DictionaryJSON } from '../dictionary/types';
import { calculateChecksum } from './checksum';
import { encode } from './encode';
import { scanFields, splitMessages } from './frame';
import { parse } from './parse';
import { SOH } from './tokenize';

const show = (s: string) => s.replace(/\x01/g, '|');

function concatBytes(parts: Array<Uint8Array | number[]>): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let i = 0;
  for (const p of parts) {
    out.set(p instanceof Uint8Array ? p : Uint8Array.from(p), i);
    i += p.length;
  }
  return out;
}

function frameDict(): DictionaryJSON {
  return {
    version: 'FIX.4.4',
    beginString: 'FIX.4.4',
    datatypes: {
      String: { name: 'String', base: 'String' },
      int: { name: 'int', base: 'int' },
      Length: { name: 'Length', base: 'int', parent: 'int' },
      data: { name: 'data', base: 'data', lengthPrefixed: true },
    },
    fields: {
      8: { tag: 8, name: 'BeginString', type: 'String' },
      9: { tag: 9, name: 'BodyLength', type: 'int' },
      35: { tag: 35, name: 'MsgType', type: 'String' },
      49: { tag: 49, name: 'SenderCompID', type: 'String' },
      56: { tag: 56, name: 'TargetCompID', type: 'String' },
      34: { tag: 34, name: 'MsgSeqNum', type: 'int' },
      10: { tag: 10, name: 'CheckSum', type: 'String' },
      58: { tag: 58, name: 'Text', type: 'String' },
      95: { tag: 95, name: 'RawDataLength', type: 'Length' },
      96: { tag: 96, name: 'RawData', type: 'data', lengthField: 95 },
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
        ],
      },
      'Standard Message Trailer': {
        name: 'Standard Message Trailer',
        members: [{ kind: 'field', tag: 10, reqd: 'Y' }],
      },
    },
    messages: [
      {
        name: 'Heartbeat',
        msgType: '0',
        category: 'admin',
        members: [
          { kind: 'component', name: 'Standard Message Header', reqd: 'Y' },
          { kind: 'component', name: 'Standard Message Trailer', reqd: 'Y' },
        ],
      },
      {
        name: 'News',
        msgType: 'B',
        category: 'app',
        members: [
          { kind: 'component', name: 'Standard Message Header', reqd: 'Y' },
          { kind: 'field', tag: 95, reqd: 'N' },
          { kind: 'field', tag: 96, reqd: 'N' },
          { kind: 'field', tag: 58, reqd: 'N' },
          { kind: 'component', name: 'Standard Message Trailer', reqd: 'Y' },
        ],
      },
    ],
  };
}

const dict = loadDictionary(frameDict());
const dec = new TextDecoder();

describe('splitMessages', () => {
  it('splits a buffer of concatenated messages by BodyLength', () => {
    const a = encode({ msgType: '0', fields: { 49: 'A', 56: 'B', 34: 1 } }, dict);
    const b = encode({ msgType: '0', fields: { 49: 'C', 56: 'D', 34: 2 } }, dict);
    const parts = splitMessages(a + b);
    expect(parts.length).toBe(2);
    expect(dec.decode(parts[0])).toBe(a);
    expect(dec.decode(parts[1])).toBe(b);
  });

  it('returns a single message unchanged and ignores trailing junk', () => {
    const a = encode({ msgType: '0', fields: { 49: 'A', 56: 'B', 34: 1 } }, dict);
    expect(splitMessages(a).map((p) => dec.decode(p))).toEqual([a]);
    expect(splitMessages(a + 'garbage').map((p) => dec.decode(p))).toEqual([a]);
  });

  it('does not mis-split when a data payload embeds an "8=" / SOH sequence', () => {
    // RawData carries a byte sequence that *looks* like the start of a new message.
    const payload = `\x018=FIX.4.4\x0199=0`;
    const len = new TextEncoder().encode(payload).length;
    const a = encode(
      { msgType: 'B', fields: { 49: 'A', 56: 'B', 34: 1, 95: len, 96: payload } },
      dict,
    );
    const b = encode({ msgType: '0', fields: { 49: 'C', 56: 'D', 34: 2 } }, dict);
    const parts = splitMessages(a + b);
    expect(parts.length).toBe(2); // the fake "8=" inside the payload is not a boundary
    expect(dec.decode(parts[0])).toBe(a);
    expect(dec.decode(parts[1])).toBe(b);
  });

  it('returns [] for empty input', () => {
    expect(splitMessages('')).toEqual([]);
    expect(splitMessages(new Uint8Array())).toEqual([]);
  });

  it('stays O(n) on many "8=" markers without a usable BodyLength (no quadratic blowup)', () => {
    const N = 20000;
    const buf = `8=X${SOH}`.repeat(N);
    const started = Date.now();
    const parts = splitMessages(buf);
    expect(parts.length).toBe(N);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe('parse framing checks are byte-accurate for binary data', () => {
  const enc = new TextEncoder();
  it('does not raise a false checksum/body-length mismatch for a non-UTF-8 data value', () => {
    // RawData 96 carries a lone 0x80 byte (invalid UTF-8); length 95=1.
    const body = concatBytes([
      enc.encode(`35=B${SOH}49=A${SOH}56=B${SOH}34=1${SOH}95=1${SOH}96=`),
      [0x80],
      [SOH.charCodeAt(0)],
    ]);
    const head = concatBytes([enc.encode(`8=FIX.4.4${SOH}9=${body.length}${SOH}`)]);
    const headBody = concatBytes([head, body]);
    const full = concatBytes([headBody, enc.encode(`10=${calculateChecksum(headBody)}${SOH}`)]);

    const { message, issues } = parse(full, dict);
    expect(message.msgType).toBe('B');
    // The framing math must read the raw bytes, not a lossily re-encoded string.
    expect(issues.find((i) => i.code === 'parse/checksum-mismatch')).toBeUndefined();
    expect(issues.find((i) => i.code === 'parse/body-length-mismatch')).toBeUndefined();
  });
});

describe('scanFields (length-aware)', () => {
  it('reads a data field whose value embeds the SOH separator', () => {
    const payload = 'a\x01b\x01c'; // 5 bytes, contains two SOHs
    const msg = encode(
      { msgType: 'B', fields: { 49: 'A', 56: 'B', 34: 1, 95: 5, 96: payload, 58: 'after' } },
      dict,
    );
    const tokens = scanFields(msg, dict);
    expect(tokens.find(([t]) => t === 96)).toEqual([96, payload]);
    // The trailing fields after the data payload are still tokenized correctly.
    expect(tokens.find(([t]) => t === 58)).toEqual([58, 'after']);
    expect(tokens.find(([t]) => t === 10)).toBeDefined();
  });

  it('matches the simple tokenizer when no data fields are present', () => {
    const msg = encode({ msgType: '0', fields: { 49: 'A', 56: 'B', 34: 1 } }, dict);
    const tokens = scanFields(msg, dict);
    expect(tokens.map(([t, v]) => `${t}=${v}`).join('|')).toBe(show(msg).replace(/\|$/, ''));
  });

  it('emits a NaN tag for a malformed segment and never throws', () => {
    const tokens = scanFields(`8=FIX.4.4${SOH}garbage${SOH}35=0${SOH}`, dict);
    expect(tokens.some(([t]) => Number.isNaN(t))).toBe(true);
    expect(tokens.find(([t]) => t === 35)).toEqual([35, '0']);
  });
});
