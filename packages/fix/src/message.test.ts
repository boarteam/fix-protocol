import { describe, expect, it } from 'vitest';
import { encode } from './codec/encode';
import { SOH } from './codec/tokenize';
import { loadDictionary } from './dictionary/Dictionary';
import type { DictionaryJSON } from './dictionary/types';
import { createFixEngine } from './engine';
import {
  type ImmutableMessage,
  createImmutableMessage,
  createMessage,
  messageFactory,
} from './message';

const show = (s: string) => s.replace(/\x01/g, '|');

/**
 * A FIX.4.4-shaped tiny dictionary with a header/trailer, a scalar-heavy Logon, and a
 * nested-group message — enough to exercise name→tag conversion, envelope merge, and
 * repeating-group rendering without the full generated dictionary.
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
      Boolean: { name: 'Boolean', base: 'char' },
      NumInGroup: { name: 'NumInGroup', base: 'int' },
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
      141: f(141, 'ResetSeqNumFlag', 'Boolean'),
      58: f(58, 'Text', 'String'),
      55: f(55, 'Symbol', 'String'),
      268: f(268, 'NoMDEntries', 'NumInGroup', true),
      269: f(269, 'MDEntryType', 'char'),
      270: f(270, 'MDEntryPx', 'String'),
      453: f(453, 'NoPartyIDs', 'NumInGroup', true),
      448: f(448, 'PartyID', 'String'),
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
          { kind: 'field', tag: 141, reqd: 'N' },
          { kind: 'component', name: 'Standard Message Trailer', reqd: 'Y' },
        ],
      },
      {
        name: 'MarketDataSnapshotFullRefresh',
        msgType: 'W',
        category: 'app',
        members: [
          { kind: 'component', name: 'Standard Message Header', reqd: 'Y' },
          { kind: 'field', tag: 55, reqd: 'N' },
          {
            kind: 'group',
            counterTag: 268,
            reqd: 'Y',
            members: [
              { kind: 'field', tag: 269, reqd: 'Y' },
              { kind: 'field', tag: 270, reqd: 'N' },
              {
                kind: 'group',
                counterTag: 453,
                reqd: 'N',
                members: [{ kind: 'field', tag: 448, reqd: 'Y' }],
              },
            ],
          },
          { kind: 'field', tag: 58, reqd: 'N' },
          { kind: 'component', name: 'Standard Message Trailer', reqd: 'Y' },
        ],
      },
    ],
  } as unknown as DictionaryJSON;
}

const dict = loadDictionary(tinyDict());

// A loose body shape for the tiny dict — the real dicts ship generated per-message types.
interface LogonBody {
  EncryptMethod: number | string;
  HeartBtInt: number | string;
  ResetSeqNumFlag?: boolean;
}
interface MDEntry {
  MDEntryType: string;
  MDEntryPx?: string;
  NoPartyIDs?: { PartyID: string }[];
}
interface MDSnapshotBody {
  Symbol?: string;
  NoMDEntries: MDEntry[];
  Text?: string;
}
interface TinyBodies {
  A: LogonBody;
  W: MDSnapshotBody;
}

const ENVELOPE = { SenderCompID: 'CLIENT', TargetCompID: 'SERVER', MsgSeqNum: 1, SendingTime: 'T' };

describe('createMessage — read/write surface', () => {
  it('sets, reads, and unsets fields (fluent, mutating)', () => {
    const msg = createMessage<LogonBody>('A', dict);
    expect(msg.msgType).toBe('A');
    const ret = msg.set('EncryptMethod', 0).set('HeartBtInt', 30);
    expect(ret).toBe(msg); // fluent returns the same instance
    expect(msg.get('EncryptMethod')).toBe(0);
    expect(msg.has('HeartBtInt')).toBe(true);
    expect(msg.has('ResetSeqNumFlag')).toBe(false);
    msg.set('HeartBtInt', 45).delete('EncryptMethod');
    expect(msg.get('HeartBtInt')).toBe(45);
    expect(msg.has('EncryptMethod')).toBe(false);
  });

  it('accepts a whole object of fields (bulk) via init and assign', () => {
    const msg = createMessage<LogonBody>('A', dict, { EncryptMethod: 0 });
    msg.assign({ HeartBtInt: 30, ResetSeqNumFlag: true });
    expect(msg.toJSON()).toEqual({ EncryptMethod: 0, HeartBtInt: 30, ResetSeqNumFlag: true });
  });
});

describe('render — byte-identical to encode()', () => {
  it('renders a scalar message identically to a hand-built encode', () => {
    const rendered = createMessage<LogonBody>('A', dict)
      .set('EncryptMethod', 0)
      .set('HeartBtInt', 30)
      .render(ENVELOPE);
    const encoded = encode(
      { msgType: 'A', fields: { 49: 'CLIENT', 56: 'SERVER', 34: 1, 52: 'T', 98: 0, 108: 30 } },
      dict,
    );
    expect(rendered).toBe(encoded);
    expect(show(rendered)).toContain('|98=0|108=30|');
  });

  it('maps booleans to Y/N and numbers via the encoder', () => {
    const rendered = createMessage<LogonBody>('A', dict)
      .assign({ EncryptMethod: 0, HeartBtInt: 30, ResetSeqNumFlag: true })
      .render(ENVELOPE);
    expect(show(rendered)).toContain('|141=Y|');
  });

  it('renders nested repeating groups identically to encode, in order', () => {
    const rendered = createMessage<MDSnapshotBody>('W', dict)
      .set('Symbol', 'AAPL')
      .set('NoMDEntries', [
        { MDEntryType: '0', MDEntryPx: '1.23', NoPartyIDs: [{ PartyID: 'P1' }, { PartyID: 'P2' }] },
        { MDEntryType: '1', MDEntryPx: '1.25' },
      ])
      .set('Text', 'hi')
      .render(ENVELOPE);
    const encoded = encode(
      {
        msgType: 'W',
        fields: { 49: 'CLIENT', 56: 'SERVER', 34: 1, 52: 'T', 55: 'AAPL', 58: 'hi' },
        groups: {
          268: [
            {
              fields: { 269: '0', 270: '1.23' },
              groups: { 453: [{ fields: { 448: 'P1' } }, { fields: { 448: 'P2' } }] },
            },
            { fields: { 269: '1', 270: '1.25' } },
          ],
        },
      },
      dict,
    );
    expect(rendered).toBe(encoded);
    expect(show(rendered)).toContain(
      '|268=2|269=0|270=1.23|453=2|448=P1|448=P2|269=1|270=1.25|58=hi|',
    );
  });

  it('is byte-accurate for non-ASCII values (UTF-8 BodyLength/CheckSum)', () => {
    const rendered = createMessage<MDSnapshotBody>('W', dict)
      .set('NoMDEntries', [{ MDEntryType: '0' }])
      .set('Text', 'Müller')
      .render(ENVELOPE);
    const encoded = encode(
      {
        msgType: 'W',
        fields: { 49: 'CLIENT', 56: 'SERVER', 34: 1, 52: 'T', 58: 'Müller' },
        groups: { 268: [{ fields: { 269: '0' } }] },
      },
      dict,
    );
    expect(rendered).toBe(encoded);
  });

  it('accepts a tag-keyed envelope identically to a name-keyed one', () => {
    const byName = createMessage<LogonBody>('A', dict)
      .assign({ EncryptMethod: 0, HeartBtInt: 30 })
      .render(ENVELOPE);
    const byTag = createMessage<LogonBody>('A', dict)
      .assign({ EncryptMethod: 0, HeartBtInt: 30 })
      .render({ 49: 'CLIENT', 56: 'SERVER', 34: 1, 52: 'T' });
    expect(byTag).toBe(byName);
  });

  it('round-trips build → render → parse', () => {
    const engine = createFixEngine(dict);
    const wire = createMessage<MDSnapshotBody>('W', dict)
      .set('Symbol', 'AAPL')
      .set('NoMDEntries', [{ MDEntryType: '0', MDEntryPx: '1.23' }])
      .render(ENVELOPE);
    const { message, issues } = engine.parse(wire);
    expect(issues).toEqual([]);
    expect(message.msgType).toBe('W');
    expect(message.fields[55]!.raw).toBe('AAPL');
    expect(message.groups[268]![0]!.fields[269]!.raw).toBe('0');
  });
});

describe('immutable message', () => {
  it('with/merge/without return new instances and never mutate the original', () => {
    const base: ImmutableMessage<LogonBody> = createImmutableMessage<LogonBody>('A', dict, {
      EncryptMethod: 0,
    });
    const next = base.with('HeartBtInt', 30);
    expect(base.has('HeartBtInt')).toBe(false); // original untouched
    expect(next.get('HeartBtInt')).toBe(30);
    const merged = next.merge({ ResetSeqNumFlag: true });
    expect(merged.get('ResetSeqNumFlag')).toBe(true);
    expect(next.has('ResetSeqNumFlag')).toBe(false);
    const dropped = merged.without('EncryptMethod');
    expect(dropped.has('EncryptMethod')).toBe(false);
    expect(merged.has('EncryptMethod')).toBe(true);
  });

  it('renders identically to the mutable path', () => {
    const mutableWire = createMessage<LogonBody>('A', dict)
      .assign({ EncryptMethod: 0, HeartBtInt: 30 })
      .render(ENVELOPE);
    const immutableWire = createImmutableMessage<LogonBody>('A', dict)
      .with('EncryptMethod', 0)
      .with('HeartBtInt', 30)
      .render(ENVELOPE);
    expect(immutableWire).toBe(mutableWire);
  });

  it('converts between mutable and immutable', () => {
    const mut = createMessage<LogonBody>('A', dict).set('EncryptMethod', 0);
    const imm = mut.toImmutable();
    mut.set('HeartBtInt', 99); // mutating the original must not affect the snapshot
    expect(imm.has('HeartBtInt')).toBe(false);
    const back = imm.toMutable().set('HeartBtInt', 30);
    expect(back.get('HeartBtInt')).toBe(30);
  });
});

describe('messageFactory + engine.create', () => {
  it('binds a dictionary and creates typed messages', () => {
    const message = messageFactory<TinyBodies>(dict);
    const wire = message('W', { Symbol: 'AAPL' })
      .set('NoMDEntries', [{ MDEntryType: '0' }])
      .render(ENVELOPE);
    expect(show(wire)).toContain('|55=AAPL|268=1|269=0|');

    const imm = message.immutable('A', { EncryptMethod: 0 }).with('HeartBtInt', 30);
    expect(imm.get('HeartBtInt')).toBe(30);
  });

  it('engine.create/createImmutable build messages bound to the engine dictionary', () => {
    const engine = createFixEngine<TinyBodies>(dict);
    const wire = engine.create('A', { EncryptMethod: 0, HeartBtInt: 30 }).render(ENVELOPE);
    // render(envelope) == encode of the same content merged with the envelope fields.
    expect(wire).toBe(
      engine.encode({
        msgType: 'A',
        fields: { 49: 'CLIENT', 56: 'SERVER', 34: 1, 52: 'T', 98: 0, 108: 30 },
      }),
    );
    // toEncodeMessage() is body-only (no envelope): it re-encodes to the envelope-free wire.
    const bodyOnly = engine.create('A', { EncryptMethod: 0, HeartBtInt: 30 }).toEncodeMessage();
    expect(engine.encode(bodyOnly, { soh: SOH })).toBe(
      engine.encode({ msgType: 'A', fields: { 98: 0, 108: 30 } }),
    );
    const imm = engine.createImmutable('A', { EncryptMethod: 0 });
    expect(imm.get('EncryptMethod')).toBe(0);
  });
});

describe('error handling', () => {
  it('throws on a field name unknown to the dictionary', () => {
    const msg = createMessage('A', dict).set('NotARealField', 'x');
    expect(() => msg.render(ENVELOPE)).toThrow(/not defined in dictionary/);
  });

  it('throws when a group name is set to a non-array', () => {
    const msg = createMessage('W', dict).set('NoMDEntries', 'oops' as unknown as never);
    expect(() => msg.render(ENVELOPE)).toThrow(/expects an array/);
  });

  it('throws on an unknown envelope field name', () => {
    const msg = createMessage<LogonBody>('A', dict).assign({ EncryptMethod: 0, HeartBtInt: 30 });
    expect(() => msg.render({ NotAHeaderField: 'x' })).toThrow(/not defined in dictionary/);
  });

  it('throws on a dictionary-valid field that is not part of this message (no silent drop)', () => {
    // Symbol(55) is a real field but not a member of Logon — encode would silently omit it.
    const msg = createMessage('A', dict).set('EncryptMethod', 0).set('Symbol', 'GHOST');
    expect(() => msg.render(ENVELOPE)).toThrow(/is not part of message "A"/);
    expect(() => msg.toEncodeMessage()).toThrow(/is not part of message "A"/);
  });

  it('throws on an out-of-structure envelope tag, symmetric with an unknown name', () => {
    const msg = createMessage<LogonBody>('A', dict).assign({ EncryptMethod: 0, HeartBtInt: 30 });
    // Tag 55 is valid in the dictionary but not part of Logon.
    expect(() => msg.render({ ...ENVELOPE, 55: 'GHOST' })).toThrow(/is not part of message "A"/);
  });

  it('throws when a scalar field is set to a non-scalar value (no JS coercion onto the wire)', () => {
    const asArray = createMessage('W', dict).set('Symbol', ['a', 'b'] as unknown as never);
    expect(() => asArray.render(ENVELOPE)).toThrow(/expects a string\/number\/boolean/);
    const asObject = createMessage('W', dict).set('Symbol', { x: 1 } as unknown as never);
    expect(() => asObject.render(ENVELOPE)).toThrow(/expects a string\/number\/boolean/);
  });

  it('treats null as absent in the read model, consistent with render', () => {
    const msg = createMessage<MDSnapshotBody>('W', dict).set('Symbol', null as unknown as never);
    expect(msg.has('Symbol')).toBe(false); // null reads as absent
    expect(show(msg.set('NoMDEntries', [{ MDEntryType: '0' }]).render(ENVELOPE))).not.toContain(
      '|55=',
    );
  });
});

describe('perf sanity — mutable hot path', () => {
  it('builds and renders many market-data snapshots without pathological slowdown', () => {
    const engine = createFixEngine<TinyBodies>(dict);
    const N = 5000;
    const t0 = performance.now();
    let bytes = 0;
    for (let i = 0; i < N; i++) {
      const wire = engine
        .create('W')
        .set('Symbol', 'AAPL')
        .set('NoMDEntries', [
          { MDEntryType: '0', MDEntryPx: '1.2345' },
          { MDEntryType: '1', MDEntryPx: '1.2346' },
        ])
        .render({ SenderCompID: 'C', TargetCompID: 'S', MsgSeqNum: i, SendingTime: 'T' });
      bytes += wire.length;
    }
    const perMsgMicros = ((performance.now() - t0) * 1000) / N;
    expect(bytes).toBeGreaterThan(0);
    // Generous bound: this is a smoke test against accidental O(n^2)/megamorphic blowups,
    // not a strict SLA. Typical local runs are well under 20µs/message.
    expect(perMsgMicros).toBeLessThan(500);
  });
});
