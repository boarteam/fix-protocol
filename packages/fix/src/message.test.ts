import { describe, expect, expectTypeOf, it } from 'vitest';
import { encode } from './codec/encode';
import { SOH } from './codec/tokenize';
import { createFixEngine } from './engine';
import {
  type ImmutableMessage,
  type MessageOf,
  type MessageView,
  createImmutableMessage,
  createMessage,
  messageFactory,
  messageTypeGuard,
} from './message';
import {
  type LogonBody,
  type MDEntry,
  type MDSnapshotBody,
  type TinyBodies,
  dict,
} from './tiny-dict.fixture';

const show = (s: string) => s.replace(/\x01/g, '|');

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
    const msg = createMessage<LogonBody>('A', dict, { EncryptMethod: 0, HeartBtInt: 15 });
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

describe('absent values — undefined, null, and empty string are skipped', () => {
  it('renders an init with absent values byte-identically to omitting the keys', () => {
    const withAbsent = createMessage<LogonBody>('A', dict, {
      EncryptMethod: 0,
      HeartBtInt: 30,
      ResetSeqNumFlag: undefined,
      Text: null,
    }).render(ENVELOPE);
    const withoutKeys = createMessage<LogonBody>('A', dict, {
      EncryptMethod: 0,
      HeartBtInt: 30,
    }).render(ENVELOPE);
    expect(withAbsent).toBe(withoutKeys);
  });

  it("'' is absent: not rendered, has() false, still readable via get()", () => {
    const msg = createMessage<LogonBody>('A', dict, { EncryptMethod: 0, HeartBtInt: 30, Text: '' });
    expect(msg.has('Text')).toBe(false);
    expect(msg.get('Text')).toBe('');
    expect(show(msg.render(ENVELOPE))).not.toContain('|58=');
  });

  it('set(null)/assign(null) unset at render; get() normalizes null to undefined', () => {
    const msg = createMessage<LogonBody>('A', dict, {
      EncryptMethod: 0,
      HeartBtInt: 30,
      ResetSeqNumFlag: true,
      Text: 'hi',
    });
    msg.set('ResetSeqNumFlag', null).assign({ Text: null });
    expect(msg.get('ResetSeqNumFlag')).toBeUndefined();
    expect(msg.has('Text')).toBe(false);
    const wire = show(msg.render(ENVELOPE));
    expect(wire).not.toContain('|141=');
    expect(wire).not.toContain('|58=');
  });

  it('skips absent values inside repeating-group entries, recursively', () => {
    const wire = createMessage<MDSnapshotBody>('W', dict, {
      NoMDEntries: [
        { MDEntryType: '0', MDEntryPx: undefined, NoPartyIDs: null },
        { MDEntryType: '1', MDEntryPx: '', NoPartyIDs: [] },
      ],
    }).render(ENVELOPE);
    const oracle = createMessage<MDSnapshotBody>('W', dict, {
      NoMDEntries: [{ MDEntryType: '0' }, { MDEntryType: '1' }],
    }).render(ENVELOPE);
    expect(wire).toBe(oracle);
    expect(show(wire)).toContain('|268=2|269=0|269=1|');
    expect(show(wire)).not.toContain('|270=');
    expect(show(wire)).not.toContain('|453=');
  });

  it('an empty group array renders no counter tag at all', () => {
    const wire = createMessage<MDSnapshotBody>('W', dict, {
      Symbol: 'AAPL',
      NoMDEntries: [],
    }).render(ENVELOPE);
    expect(show(wire)).toContain('|55=AAPL|');
    expect(show(wire)).not.toContain('|268=');
  });

  it('applies the same absence rule to envelope fields', () => {
    const base = createMessage<LogonBody>('A', dict, { EncryptMethod: 0, HeartBtInt: 30 });
    const plain = base.render(ENVELOPE);
    expect(base.render({ ...ENVELOPE, OnBehalfOfCompID: undefined })).toBe(plain);
    expect(base.render({ ...ENVELOPE, OnBehalfOfCompID: null })).toBe(plain);
    expect(base.render({ ...ENVELOPE, OnBehalfOfCompID: '' })).toBe(plain);
    expect(show(base.render({ ...ENVELOPE, OnBehalfOfCompID: 'OBO' }))).toContain('|115=OBO|');
  });
});

describe('immutable message', () => {
  it('with/merge/without return new instances and never mutate the original', () => {
    const base: ImmutableMessage<LogonBody> = createImmutableMessage<LogonBody>('A', dict).with(
      'EncryptMethod',
      0,
    );
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
    const wire = message('W', {
      Symbol: 'AAPL',
      NoMDEntries: [{ MDEntryType: '0' }],
    }).render(ENVELOPE);
    expect(show(wire)).toContain('|55=AAPL|268=1|269=0|');

    // `HeartBtInt: undefined` names the required key while deliberately leaving it unset.
    const imm = message
      .immutable('A', { EncryptMethod: 0, HeartBtInt: undefined })
      .with('HeartBtInt', 30);
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
    const imm = engine.createImmutable('A', { EncryptMethod: 0, HeartBtInt: undefined });
    expect(imm.get('EncryptMethod')).toBe(0);
  });
});

describe('type-level: MessageInit requiredness and widening', () => {
  const message = messageFactory<TinyBodies>(dict);

  it('requires required keys when an init is passed; values may be null/undefined', () => {
    message('A', { EncryptMethod: 0, HeartBtInt: 30 }); // complete init
    message('A', { EncryptMethod: 0, HeartBtInt: undefined }); // named, deliberately unset
    message('A', { EncryptMethod: null, HeartBtInt: null }); // absent at render
    message('A'); // no init at all — incremental building stays lenient
    // @ts-expect-error an init must name the required EncryptMethod and HeartBtInt
    message('A', {});
    // @ts-expect-error an init must name the required HeartBtInt
    message('A', { EncryptMethod: 0 });
    // @ts-expect-error a group entry still requires its required members
    message('W', { NoMDEntries: [{ MDEntryPx: '1.0' }] });
  });

  it('widens set()/assign() values but not get() reads', () => {
    const a = message('A', { EncryptMethod: 0, HeartBtInt: 30 });
    const maybeText: string | null | undefined = null;
    a.set('Text', maybeText); // no guard needed
    a.assign({ ResetSeqNumFlag: true }); // assign stays partial — no required keys demanded
    expectTypeOf(a.get('Text')).toEqualTypeOf<string | undefined>();
    expectTypeOf(a.toJSON().Text).toEqualTypeOf<string | null | undefined>();
  });
});

describe('messageTypeGuard + engine.is — narrow an unknown message', () => {
  const isMessageType = messageTypeGuard<TinyBodies>();
  const engine = createFixEngine<TinyBodies>(dict);

  it('returns the correct boolean (standalone guard and engine.is)', () => {
    const w: MessageView<any> = createMessage<MDSnapshotBody>('W', dict);
    const a: MessageView<any> = createMessage<LogonBody>('A', dict);
    expect(isMessageType(w, 'W')).toBe(true);
    expect(isMessageType(w, 'A')).toBe(false);
    expect(isMessageType(a, 'A')).toBe(true);
    // engine.is is the same guard with Bodies already bound.
    expect(engine.is(w, 'W')).toBe(true);
    expect(engine.is(a, 'W')).toBe(false);
    expect(engine.is(a, 'A')).toBe(true);
  });

  it('narrows MessageView<any> to the typed read surface inside the guard', () => {
    // The generic-boundary shape: the concrete body is erased to `any`.
    const m: MessageView<any> = createMessage<MDSnapshotBody>('W', dict, {
      Symbol: 'AAPL',
      NoMDEntries: [{ MDEntryType: '0' }],
    });
    // guard(m, 'W') compiles for m: MessageView<any> …
    if (isMessageType(m, 'W')) {
      // … and inside, reads are typed to the W body.
      expectTypeOf(m.get('Symbol')).toEqualTypeOf<string | undefined>();
      expectTypeOf(m.get('NoMDEntries')).toEqualTypeOf<MDEntry[] | undefined>();
      // Runtime reads still work through the narrowed view.
      expect(m.get('Symbol')).toBe('AAPL');
      expect(m.get('NoMDEntries')?.[0]?.MDEntryType).toBe('0');
      // @ts-expect-error — SecurityID is not a field of the W body
      m.get('SecurityID');
    }
    // @ts-expect-error — 'ZZ' is not a MsgType value in TinyBodies
    isMessageType(m, 'ZZ');
  });

  it('narrows an immutable message too — it targets the shared read surface', () => {
    // The guard narrows to MessageView, which MutableMessage and ImmutableMessage both extend,
    // so the immutable flavour must pass through it exactly like the mutable one.
    const imm: MessageView<any> = createImmutableMessage<MDSnapshotBody>('W', dict, {
      Symbol: 'AAPL',
      NoMDEntries: [{ MDEntryType: '0' }],
    });
    expect(isMessageType(imm, 'W')).toBe(true);
    expect(isMessageType(imm, 'A')).toBe(false);
    if (isMessageType(imm, 'W')) {
      expectTypeOf(imm.get('NoMDEntries')).toEqualTypeOf<MDEntry[] | undefined>();
      expect(imm.get('Symbol')).toBe('AAPL');
    }
  });

  it('engine.is narrows identically, and MessageOf annotates a narrowed message', () => {
    const m: MessageView<any> = engine.create('W', { NoMDEntries: [{ MDEntryType: '0' }] });
    if (engine.is(m, 'W')) {
      expectTypeOf(m.get('NoMDEntries')).toEqualTypeOf<MDEntry[] | undefined>();
    }
    // MessageOf<Bodies, M> is the read surface of message M — usable as an annotation.
    expectTypeOf<MessageOf<TinyBodies, 'W'>>().toEqualTypeOf<
      MessageView<MDSnapshotBody & object>
    >();
    const readEntries = (w: MessageOf<TinyBodies, 'W'>): MDEntry[] | undefined =>
      w.get('NoMDEntries');
    expect(readEntries(engine.create('W', { NoMDEntries: [{ MDEntryType: '0' }] }))).toEqual([
      { MDEntryType: '0' },
    ]);
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
    const msg = createMessage<MDSnapshotBody>('W', dict).set('Symbol', null);
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
