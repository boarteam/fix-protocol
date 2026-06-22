import { describe, expect, it } from 'vitest';
import { loadDictionary } from '../dictionary/Dictionary';
import type { DictionaryJSON } from '../dictionary/types';
import { calculateChecksum, bodyLength } from './checksum';
import { encode } from './encode';
import { parse, parseAll, toEncodeMessage } from './parse';
import { SOH } from './tokenize';

/** A market-data-incremental-shaped dict: a top-level group (268) nesting another (711). */
function mdDict(): DictionaryJSON {
  const enumChar = (tag: number, name: string, values: [string, string][]) => ({
    tag,
    name,
    type: 'char',
    enumValues: values.map(([value, n]) => ({ value, name: n, description: n })),
  });
  return {
    version: 'FIX.4.4',
    beginString: 'FIX.4.4',
    datatypes: {
      String: { name: 'String', base: 'String' },
      int: { name: 'int', base: 'int' },
      char: { name: 'char', base: 'char' },
      Price: { name: 'Price', base: 'float', parent: 'float' },
      Qty: { name: 'Qty', base: 'float', parent: 'float' },
      float: { name: 'float', base: 'float' },
      NumInGroup: { name: 'NumInGroup', base: 'int', parent: 'int' },
      UTCTimestamp: { name: 'UTCTimestamp', base: 'String', parent: 'String' },
    },
    fields: {
      8: { tag: 8, name: 'BeginString', type: 'String' },
      9: { tag: 9, name: 'BodyLength', type: 'int' },
      35: { tag: 35, name: 'MsgType', type: 'String' },
      49: { tag: 49, name: 'SenderCompID', type: 'String' },
      56: { tag: 56, name: 'TargetCompID', type: 'String' },
      34: { tag: 34, name: 'MsgSeqNum', type: 'int' },
      52: { tag: 52, name: 'SendingTime', type: 'UTCTimestamp' },
      10: { tag: 10, name: 'CheckSum', type: 'String' },
      262: { tag: 262, name: 'MDReqID', type: 'String' },
      268: { tag: 268, name: 'NoMDEntries', type: 'NumInGroup', isGroupCounter: true },
      279: enumChar(279, 'MDUpdateAction', [
        ['0', 'New'],
        ['1', 'Change'],
        ['2', 'Delete'],
      ]),
      269: enumChar(269, 'MDEntryType', [
        ['0', 'Bid'],
        ['1', 'Offer'],
        ['2', 'Trade'],
      ]),
      55: { tag: 55, name: 'Symbol', type: 'String' },
      270: { tag: 270, name: 'MDEntryPx', type: 'Price' },
      271: { tag: 271, name: 'MDEntrySize', type: 'Qty' },
      711: { tag: 711, name: 'NoUnderlyings', type: 'NumInGroup', isGroupCounter: true },
      311: { tag: 311, name: 'UnderlyingSymbol', type: 'String' },
      318: { tag: 318, name: 'UnderlyingCurrency', type: 'String' },
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
        name: 'Heartbeat',
        msgType: '0',
        category: 'admin',
        members: [
          { kind: 'component', name: 'Standard Message Header', reqd: 'Y' },
          { kind: 'component', name: 'Standard Message Trailer', reqd: 'Y' },
        ],
      },
      {
        name: 'MarketDataIncremental',
        msgType: 'X',
        category: 'app',
        members: [
          { kind: 'component', name: 'Standard Message Header', reqd: 'Y' },
          { kind: 'field', tag: 262, reqd: 'N' },
          {
            kind: 'group',
            counterTag: 268,
            reqd: 'Y',
            members: [
              { kind: 'field', tag: 279, reqd: 'Y' },
              { kind: 'field', tag: 269, reqd: 'C' },
              { kind: 'field', tag: 55, reqd: 'N' },
              {
                kind: 'group',
                counterTag: 711,
                reqd: 'N',
                members: [
                  { kind: 'field', tag: 311, reqd: 'Y' },
                  { kind: 'field', tag: 318, reqd: 'N' },
                ],
              },
              { kind: 'field', tag: 270, reqd: 'C' },
              { kind: 'field', tag: 271, reqd: 'C' },
            ],
          },
          { kind: 'component', name: 'Standard Message Trailer', reqd: 'Y' },
        ],
      },
    ],
  };
}

const dict = loadDictionary(mdDict());

/** Frame an ordered list of body fields (35=… first) with a correct BodyLength/CheckSum. */
function frameMsg(fieldsAfter9: string[]): string {
  const body = fieldsAfter9.join(SOH) + SOH;
  const head = `8=FIX.4.4${SOH}9=${bodyLength(body)}${SOH}`;
  const framed = head + body;
  return `${framed}10=${calculateChecksum(framed)}${SOH}`;
}

const sampleX = (): ReturnType<typeof encode> =>
  encode(
    {
      msgType: 'X',
      fields: { 49: 'CLIENT', 56: 'SERVER', 34: 5, 52: '20260620-12:00:00', 262: 'req1' },
      groups: {
        268: [
          {
            fields: { 279: '0', 269: '2', 55: 'EURUSD', 270: 1.1, 271: 1000000 },
            groups: { 711: [{ fields: { 311: 'EUR', 318: 'USD' } }, { fields: { 311: 'GBP' } }] },
          },
          { fields: { 279: '1', 269: '0', 55: 'GBPUSD' } },
        ],
      },
    },
    dict,
  );

describe('parse — structure & groups', () => {
  it('reconstructs nested repeating groups as arrays of objects', () => {
    const { message, issues } = parse(sampleX(), dict);
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(message.msgType).toBe('X');
    expect(message.name).toBe('MarketDataIncremental');
    expect(message.beginString).toBe('FIX.4.4');
    expect(message.framed).toBe(true);

    // Top-level fields (header + MDReqID).
    expect(message.fields[49]?.value).toBe('CLIENT');
    expect(message.fields[34]?.value).toBe(5);
    expect(message.fields[262]?.value).toBe('req1');

    const entries = message.groups[268]!;
    expect(entries.length).toBe(2);

    // First entry: enum opaque, float/qty coerced, with a nested group of two.
    expect(entries[0]!.fields[279]?.value).toBe('0');
    expect(entries[0]!.fields[269]?.value).toBe('2');
    expect(entries[0]!.fields[270]?.value).toBe(1.1);
    expect(entries[0]!.fields[271]?.value).toBe(1000000);
    const underlyings = entries[0]!.groups[711]!;
    expect(underlyings.length).toBe(2);
    expect(underlyings[0]!.fields[311]?.value).toBe('EUR');
    expect(underlyings[0]!.fields[318]?.value).toBe('USD');
    expect(underlyings[1]!.fields[311]?.value).toBe('GBP');
    expect(underlyings[1]!.fields[318]).toBeUndefined();

    // Second entry: no nested group.
    expect(entries[1]!.fields[55]?.value).toBe('GBPUSD');
    expect(entries[1]!.groups[711]).toBeUndefined();
  });

  it('round-trips encode(toEncodeMessage(parse(x))) === x', () => {
    const x = sampleX();
    const { message } = parse(x, dict);
    const reencoded = encode(toEncodeMessage(message), dict);
    expect(reencoded).toBe(x);
  });

  it('attaches issue paths that locate the field inside its group entry', () => {
    // A bad float inside the second-entry... craft via frame: 270=oops in entry 0.
    const msg = frameMsg(['35=X', '49=A', '56=B', '34=1', '52=T', '268=1', '279=0', '270=oops']);
    const { issues } = parse(msg, dict);
    const bad = issues.find((i) => i.code === 'parse/invalid-float');
    expect(bad?.path).toBe('NoMDEntries[0].MDEntryPx');
  });
});

describe('parse — diagnostics', () => {
  it('flags a group count mismatch but keeps every parsed entry', () => {
    const msg = frameMsg([
      '35=X',
      '49=A',
      '56=B',
      '34=1',
      '52=T',
      '268=3',
      '279=0',
      '279=1', // declares 3, supplies 2
    ]);
    const { message, issues } = parse(msg, dict);
    expect(message.groups[268]!.length).toBe(2); // structure wins over the declared count
    const mismatch = issues.find((i) => i.code === 'parse/group-count-mismatch');
    expect(mismatch?.severity).toBe('warning');
    expect(mismatch?.refTagID).toBe(268);
  });

  it('flags a non-numeric group count and treats it as zero', () => {
    const msg = frameMsg(['35=X', '49=A', '56=B', '34=1', '52=T', '268=x', '279=0']);
    const { issues } = parse(msg, dict);
    expect(issues.find((i) => i.code === 'parse/invalid-group-count')).toBeDefined();
  });

  it('flags a duplicate non-group tag in the same scope, keeping the first', () => {
    const msg = frameMsg(['35=X', '49=A', '56=B', '34=1', '52=T', '262=first', '262=second']);
    const { message, issues } = parse(msg, dict);
    expect(message.fields[262]?.value).toBe('first');
    expect(issues.find((i) => i.code === 'parse/duplicate-tag')?.refTagID).toBe(262);
  });

  it('flags a duplicate group counter in the same scope, keeping the first group', () => {
    const msg = frameMsg([
      '35=X',
      '49=A',
      '56=B',
      '34=1',
      '52=T',
      '268=1',
      '279=0', // first NoMDEntries group
      '268=1',
      '279=1', // a second, malformed NoMDEntries group at the same scope
    ]);
    const { message, issues } = parse(msg, dict);
    expect(message.groups[268]!.length).toBe(1);
    expect(message.groups[268]![0]!.fields[279]?.value).toBe('0'); // first group kept
    const dup = issues.find((i) => i.code === 'parse/duplicate-group');
    expect(dup?.refTagID).toBe(268);
    expect(dup?.severity).toBe('warning');
  });

  it('keeps an unknown / out-of-message tag at top level with an issue', () => {
    const known = frameMsg(['35=X', '49=A', '56=B', '34=1', '52=T', '999999=z']);
    const u = parse(known, dict).issues;
    expect(u.find((i) => i.code === 'parse/unknown-tag')?.refTagID).toBe(999999);

    const notInMsg = frameMsg(['35=0', '49=A', '56=B', '34=1', '52=T', '262=stray']);
    const n = parse(notInMsg, dict).issues; // 262 exists but is not in Heartbeat
    expect(n.find((i) => i.code === 'parse/tag-not-in-message')?.refTagID).toBe(262);
  });

  it('reports a missing then an unknown MsgType', () => {
    const noType = parse(frameMsg(['49=A', '56=B', '34=1', '52=T']), dict).issues;
    expect(noType.find((i) => i.code === 'parse/missing-msgtype')).toBeDefined();

    const badType = parse(frameMsg(['35=ZZ', '49=A', '56=B', '34=1', '52=T']), dict).issues;
    expect(badType.find((i) => i.code === 'parse/unknown-msgtype')?.refMsgType).toBe('ZZ');
  });

  it('reports an empty input', () => {
    const { message, issues } = parse('', dict);
    expect(message.msgType).toBe('');
    expect(issues[0]?.code).toBe('parse/empty-input');
  });
});

describe('parse — framing checks', () => {
  it('detects a checksum mismatch', () => {
    const good = frameMsg(['35=0', '49=A', '56=B', '34=1', '52=T']);
    const tampered = good.replace(/10=\d{3}/, '10=000');
    const { issues } = parse(tampered, dict);
    expect(issues.find((i) => i.code === 'parse/checksum-mismatch')).toBeDefined();
  });

  it('detects a BeginString that does not match the dictionary', () => {
    const msg = frameMsg(['35=0', '49=A', '56=B', '34=1', '52=T']).replace(
      '8=FIX.4.4',
      '8=FIX.4.2',
    );
    // Re-frame so only the BeginString differs (checksum stays valid for the new bytes).
    const body = `35=0${SOH}49=A${SOH}56=B${SOH}34=1${SOH}52=T${SOH}`;
    const head = `8=FIX.4.2${SOH}9=${bodyLength(body)}${SOH}`;
    const reframed = `${head}${body}10=${calculateChecksum(head + body)}${SOH}`;
    const { issues } = parse(reframed, dict);
    expect(issues.find((i) => i.code === 'parse/begin-string-mismatch')?.severity).toBe('warning');
    void msg;
  });

  it('skips framing checks when checkFraming is false', () => {
    const tampered = frameMsg(['35=0', '49=A', '56=B', '34=1', '52=T']).replace(
      /10=\d{3}/,
      '10=000',
    );
    const { issues } = parse(tampered, dict, { checkFraming: false });
    expect(issues.find((i) => i.code === 'parse/checksum-mismatch')).toBeUndefined();
  });
});

describe('parse — robustness (never throws / never hangs)', () => {
  const garbage = [
    '',
    SOH,
    `${SOH}${SOH}${SOH}`,
    'not a fix message at all',
    'just=one=field',
    `8=FIX.4.4${SOH}`,
    `35=X${SOH}268=`,
    `8=FIX.4.4${SOH}9=abc${SOH}35=X${SOH}10=zzz${SOH}`,
    `35=X${SOH}268=-5${SOH}279=0${SOH}`,
    `35=X${SOH}\x01\x0235=garbage`,
  ];
  it.each(garbage)('does not throw on malformed input %#', (input) => {
    expect(() => parse(input, dict)).not.toThrow();
    expect(() => parseAll(input, dict)).not.toThrow();
  });

  it('handles an enormous declared group count in O(1) without pre-allocating', () => {
    const msg = frameMsg(['35=X', '49=A', '56=B', '34=1', '52=T', '268=999999999', '279=0']);
    const started = Date.now();
    const { message, issues } = parse(msg, dict);
    // One real entry parsed; the absurd count is just a mismatch warning — no huge array.
    expect(message.groups[268]!.length).toBe(1);
    expect(issues.find((i) => i.code === 'parse/group-count-mismatch')).toBeDefined();
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('tolerates a data length that overruns the buffer', () => {
    // RawDataLength is not in mdDict, so use a malformed length on a known-but-untyped path:
    const msg = `8=FIX.4.4${SOH}9=10${SOH}35=X${SOH}55=AB`; // truncated, no trailer
    expect(() => parse(msg, dict)).not.toThrow();
  });
});

describe('parseAll', () => {
  it('parses every concatenated message; parse() returns only the first', () => {
    const a = encode({ msgType: '0', fields: { 49: 'A', 56: 'B', 34: 1 } }, dict);
    const b = encode({ msgType: '0', fields: { 49: 'C', 56: 'D', 34: 2 } }, dict);
    const all = parseAll(a + b, dict);
    expect(all.length).toBe(2);
    expect(all[0]!.message.fields[49]?.value).toBe('A');
    expect(all[1]!.message.fields[49]?.value).toBe('C');

    const first = parse(a + b, dict);
    expect(first.message.fields[49]?.value).toBe('A');
  });

  it('agrees with parse() on a header-less fragment (no 8=): both yield one message', () => {
    const fragment = `35=0${SOH}49=A${SOH}56=B${SOH}34=1${SOH}`;
    const all = parseAll(fragment, dict, { checkFraming: false });
    expect(all.length).toBe(1);
    expect(all[0]!.message.fields[49]?.value).toBe('A');
    expect(parse(fragment, dict, { checkFraming: false }).message.fields[49]?.value).toBe('A');
    expect(parseAll('', dict)).toEqual([]);
  });
});

describe('parse — group whose first member is itself a group (custom dictionary)', () => {
  // Stock FIX 4.4 has no such group, but the engine must handle a custom dictionary safely:
  // the outer group's delimiter is the inner group's counter (see Dictionary.groupDelimiterTag).
  const nested = loadDictionary({
    version: 'FIX.4.4',
    beginString: 'FIX.4.4',
    datatypes: {
      String: { name: 'String', base: 'String' },
      int: { name: 'int', base: 'int' },
      NumInGroup: { name: 'NumInGroup', base: 'int', parent: 'int' },
    },
    fields: {
      8: { tag: 8, name: 'BeginString', type: 'String' },
      9: { tag: 9, name: 'BodyLength', type: 'int' },
      35: { tag: 35, name: 'MsgType', type: 'String' },
      10: { tag: 10, name: 'CheckSum', type: 'String' },
      100: { tag: 100, name: 'NoOuter', type: 'NumInGroup', isGroupCounter: true },
      200: { tag: 200, name: 'NoInner', type: 'NumInGroup', isGroupCounter: true },
      201: { tag: 201, name: 'InnerField', type: 'String' },
      102: { tag: 102, name: 'OuterField', type: 'String' },
    },
    components: {
      'Standard Message Header': {
        name: 'Standard Message Header',
        members: [
          { kind: 'field', tag: 8, reqd: 'Y' },
          { kind: 'field', tag: 9, reqd: 'Y' },
          { kind: 'field', tag: 35, reqd: 'Y' },
        ],
      },
      'Standard Message Trailer': {
        name: 'Standard Message Trailer',
        members: [{ kind: 'field', tag: 10, reqd: 'Y' }],
      },
    },
    messages: [
      {
        name: 'X',
        msgType: 'X',
        category: 'app',
        members: [
          { kind: 'component', name: 'Standard Message Header', reqd: 'Y' },
          {
            kind: 'group',
            counterTag: 100,
            reqd: 'N',
            members: [
              {
                kind: 'group',
                counterTag: 200,
                reqd: 'Y',
                members: [{ kind: 'field', tag: 201, reqd: 'Y' }],
              },
              { kind: 'field', tag: 102, reqd: 'N' },
            ],
          },
          { kind: 'component', name: 'Standard Message Trailer', reqd: 'Y' },
        ],
      },
    ],
  });

  it('opens the nested group rather than recording its counter as a scalar', () => {
    const body = `35=X${SOH}100=1${SOH}200=1${SOH}201=i1${SOH}102=o1${SOH}`;
    const head = `8=FIX.4.4${SOH}9=${bodyLength(body)}${SOH}`;
    const msg = `${head}${body}10=${calculateChecksum(head + body)}${SOH}`;
    const { message, issues } = parse(msg, nested);
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
    const outer = message.groups[100]!;
    expect(outer.length).toBe(1);
    // The inner group is reconstructed inside the outer entry, not flattened to a scalar 200.
    expect(outer[0]!.groups[200]![0]!.fields[201]?.value).toBe('i1');
    expect(outer[0]!.fields[102]?.value).toBe('o1');
    expect(outer[0]!.fields[200]).toBeUndefined();
  });
});
