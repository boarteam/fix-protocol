import { describe, expect, it } from 'vitest';
import { encode } from '../codec/encode';
import { parse } from '../codec/parse';
import { validate } from '../validate/validate';
import { createFixEngine } from '../engine';
import type { FixIssue } from '../errors';
import { loadDictionary } from './Dictionary';
import { extendDictionary } from './extendDictionary';
import { type FixtDictionaries, isFixtDictionaries, mergeFixtDictionaries } from './fixt';
import type { DictionaryJSON } from './types';
import { validateDictionary } from './validateDictionary';

/**
 * FIXT pair semantics over tiny inline dictionaries (per the engine test style): a
 * FIXT-shaped transport (envelope + Logon/Heartbeat) and an envelope-less application
 * layer (NewOrderSingle), so every branch — merge, wrap, layer attribution, resolver
 * routing, purity check — is exercised without the full generated dictionaries.
 */
function transportDict(): DictionaryJSON {
  return {
    version: 'FIXT.1.1',
    beginString: 'FIXT.1.1',
    datatypes: {
      String: { name: 'String', base: 'String' },
      int: { name: 'int', base: 'int' },
      UTCTimestamp: {
        name: 'UTCTimestamp',
        base: 'String',
        formatPattern: 'YYYYMMDD-HH:MM:SS[.sss]',
      },
    },
    fields: {
      8: { tag: 8, name: 'BeginString', type: 'String' },
      9: { tag: 9, name: 'BodyLength', type: 'int' },
      35: { tag: 35, name: 'MsgType', type: 'String' },
      49: { tag: 49, name: 'SenderCompID', type: 'String' },
      56: { tag: 56, name: 'TargetCompID', type: 'String' },
      34: { tag: 34, name: 'MsgSeqNum', type: 'int' },
      52: { tag: 52, name: 'SendingTime', type: 'UTCTimestamp' },
      1128: {
        tag: 1128,
        name: 'ApplVerID',
        type: 'String',
        enumValues: [
          { value: '8', name: 'FIX50SP1', description: 'FIX50SP1' },
          { value: '9', name: 'FIX50SP2', description: 'FIX50SP2' },
        ],
      },
      10: { tag: 10, name: 'CheckSum', type: 'String' },
      108: { tag: 108, name: 'HeartBtInt', type: 'int' },
      1137: { tag: 1137, name: 'DefaultApplVerID', type: 'String' },
      112: { tag: 112, name: 'TestReqID', type: 'String' },
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
          { kind: 'field', tag: 1128, reqd: 'N' },
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
          { kind: 'field', tag: 108, reqd: 'Y' },
          { kind: 'field', tag: 1137, reqd: 'Y' },
          { kind: 'component', name: 'Standard Message Trailer', reqd: 'Y' },
        ],
      },
      {
        name: 'Heartbeat',
        msgType: '0',
        category: 'admin',
        members: [
          { kind: 'component', name: 'Standard Message Header', reqd: 'Y' },
          { kind: 'field', tag: 112, reqd: 'N' },
          { kind: 'component', name: 'Standard Message Trailer', reqd: 'Y' },
        ],
      },
    ],
  };
}

/** The FIX 5.0 SP2 application layer: envelope-less bodies, per the app-only XML shape. */
function appDict(): DictionaryJSON {
  return {
    version: 'FIX.5.0SP2',
    beginString: 'FIX.5.0',
    applVerID: '9',
    datatypes: {
      String: { name: 'String', base: 'String' },
      char: { name: 'char', base: 'char' },
    },
    fields: {
      11: { tag: 11, name: 'ClOrdID', type: 'String' },
      55: { tag: 55, name: 'Symbol', type: 'String' },
      54: {
        tag: 54,
        name: 'Side',
        type: 'char',
        enumValues: [
          { value: '1', name: 'BUY', description: 'Buy' },
          { value: '2', name: 'SELL', description: 'Sell' },
        ],
      },
    },
    components: {},
    messages: [
      {
        name: 'NewOrderSingle',
        msgType: 'D',
        category: 'app',
        members: [
          { kind: 'field', tag: 11, reqd: 'Y' },
          { kind: 'field', tag: 55, reqd: 'Y' },
          { kind: 'field', tag: 54, reqd: 'Y' },
        ],
      },
    ],
  };
}

/** An "SP1" application layer that does NOT define NewOrderSingle at all. */
function appDictSp1(): DictionaryJSON {
  return {
    version: 'FIX.5.0SP1',
    beginString: 'FIX.5.0',
    applVerID: '8',
    datatypes: { String: { name: 'String', base: 'String' } },
    fields: { 11: { tag: 11, name: 'ClOrdID', type: 'String' } },
    components: {},
    messages: [],
  };
}

const SOH = '|';
const ENV_FIELDS = { 49: 'ME', 56: 'YOU', 34: 1, 52: '20260801-12:00:00' };

const pair = (): FixtDictionaries => ({ transport: transportDict(), app: appDict() });

const errors = (issues: FixIssue[]) => issues.filter((i) => i.severity === 'error');

describe('isFixtDictionaries', () => {
  it('distinguishes the pair form from dictionaries', () => {
    expect(isFixtDictionaries(pair())).toBe(true);
    expect(isFixtDictionaries(transportDict())).toBe(false);
    expect(isFixtDictionaries(loadDictionary(transportDict()))).toBe(false);
  });
});

describe('mergeFixtDictionaries (runtime)', () => {
  const merged = mergeFixtDictionaries(transportDict(), appDict());

  it('takes identity from the right layers: app version/applVerID, transport beginString', () => {
    expect(merged.version).toBe('FIX.5.0SP2');
    expect(merged.beginString).toBe('FIXT.1.1');
    expect(merged.applVerID).toBe('9');
  });

  it('wraps envelope-less app messages and keeps session messages as-is', () => {
    const d = merged.messages.find((m) => m.msgType === 'D')!;
    expect(d.members[0]).toMatchObject({ kind: 'component', name: 'Standard Message Header' });
    expect(d.members.at(-1)).toMatchObject({
      kind: 'component',
      name: 'Standard Message Trailer',
    });
    expect(merged.messages.map((m) => m.msgType).sort()).toEqual(['0', 'A', 'D']);
  });

  it('produces a gate-clean dictionary', () => {
    expect(validateDictionary(merged)).toEqual([]);
  });

  it('is idempotent over an already-merged app side (session set is transport-owned)', () => {
    const again = mergeFixtDictionaries(transportDict(), merged);
    expect(again.messages).toEqual(merged.messages);
    expect(again.fields).toEqual(merged.fields);
  });

  it('throws on a contradictory shared definition', () => {
    const clash = appDict();
    clash.fields[1137] = { tag: 1137, name: 'NotDefaultApplVerID', type: 'String' };
    expect(() => mergeFixtDictionaries(transportDict(), clash)).toThrow(/contradictorily/);
  });

  it('throws when the transport has no detectable envelope', () => {
    const bare = appDict();
    expect(() => mergeFixtDictionaries(bare, appDict())).toThrow(/no detectable header\/trailer/);
  });

  it('supports extendDictionary on the merged form', () => {
    const { dictionary, issues } = extendDictionary(merged, {
      fields: { VenueHint: { tag: 5001, type: 'String' } },
      messages: {
        NewOrderSingle: { append: ['VenueHint'] },
      },
    });
    expect(errors(issues)).toEqual([]);
    expect(validateDictionary(dictionary)).toEqual([]);
    expect(loadDictionary(dictionary).allowedTags('D')).toContain(5001);
  });
});

describe('parse/encode over a FIXT pair', () => {
  it('encodes an application message wrapped in the transport envelope', () => {
    const wire = encode(
      { msgType: 'D', fields: { ...ENV_FIELDS, 11: 'ORD1', 55: 'EURUSD', 54: '1' } },
      pair(),
      { soh: SOH },
    );
    expect(wire.startsWith('8=FIXT.1.1|')).toBe(true);
    expect(wire).toContain('|49=ME|');
    expect(wire).toContain('|11=ORD1|');
  });

  it('encodes a session message from the transport definitions', () => {
    const wire = encode({ msgType: 'A', fields: { ...ENV_FIELDS, 108: 30, 1137: '9' } }, pair(), {
      soh: SOH,
    });
    expect(wire.startsWith('8=FIXT.1.1|')).toBe(true);
    expect(wire).toContain('|1137=9|');
  });

  it('parses both layers with full structure and no error issues', () => {
    const p = pair();
    for (const wire of [
      encode({ msgType: 'D', fields: { ...ENV_FIELDS, 11: 'ORD1', 55: 'EURUSD', 54: '1' } }, p, {
        soh: SOH,
      }),
      encode({ msgType: 'A', fields: { ...ENV_FIELDS, 108: 30, 1137: '9' } }, p, { soh: SOH }),
    ]) {
      const { message, issues } = parse(wire, p, { soh: SOH });
      expect(errors(issues)).toEqual([]);
      expect(message.framed).toBe(true);
      expect(message.beginString).toBe('FIXT.1.1');
    }
  });

  it('flags a BeginString that does not match the TRANSPORT dialect', () => {
    const { issues } = parse('8=FIX.4.4|9=5|35=0|49=A|56=B|34=1|10=000|', pair(), { soh: SOH });
    const mismatch = issues.find((i) => i.code === 'parse/begin-string-mismatch');
    expect(mismatch?.message).toContain('"FIXT.1.1"');
  });
});

describe('validate over a FIXT pair — layer attribution', () => {
  const p = pair();

  const parsed = (wire: string) => parse(wire, p, { soh: SOH }).message;

  it('returns no layer on single-dictionary validation (backward compatible)', () => {
    const merged = loadDictionary(mergeFixtDictionaries(transportDict(), appDict()));
    const wire = encode({ msgType: 'A', fields: { ...ENV_FIELDS, 108: 30, 1137: '9' } }, merged, {
      soh: SOH,
    });
    const withoutHeartbeat = parse(wire, merged, { soh: SOH }).message;
    delete withoutHeartbeat.fields[108];
    const issues = validate(withoutHeartbeat, merged);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((i) => i.layer === undefined)).toBe(true);
  });

  it('a clean message on each layer validates with zero issues', () => {
    const logon = parsed(
      encode({ msgType: 'A', fields: { ...ENV_FIELDS, 108: 30, 1137: '9' } }, p, { soh: SOH }),
    );
    expect(validate(logon, p)).toEqual([]);
    const order = parsed(
      encode({ msgType: 'D', fields: { ...ENV_FIELDS, 11: 'O1', 55: 'EURUSD', 54: '1' } }, p, {
        soh: SOH,
      }),
    );
    expect(validate(order, p)).toEqual([]);
  });

  it('missing DefaultApplVerID on Logon is a SESSION finding', () => {
    const logon = parsed(
      encode({ msgType: 'A', fields: { ...ENV_FIELDS, 108: 30 } }, p, { soh: SOH }),
    );
    const issues = validate(logon, p);
    const miss = issues.find(
      (i) => i.code === 'validate/required-field-missing' && i.refTagID === 1137,
    );
    expect(miss?.layer).toBe('session');
  });

  it('an application-layer field on a session message is flagged field-outside-layer', () => {
    const logon = parsed(
      encode({ msgType: 'A', fields: { ...ENV_FIELDS, 108: 30, 1137: '9' } }, p, { soh: SOH }),
    );
    logon.fields[55] = { tag: 55, name: 'Symbol', raw: 'EURUSD', value: 'EURUSD' };
    const issues = validate(logon, p);
    const outside = issues.find((i) => i.code === 'validate/field-outside-layer');
    expect(outside).toMatchObject({
      severity: 'error',
      refTagID: 55,
      layer: 'session',
      sessionRejectReason: 2,
    });
  });

  it('a missing required body field on an app message is an APPLICATION finding', () => {
    const order = parsed(
      encode({ msgType: 'D', fields: { ...ENV_FIELDS, 11: 'O1', 54: '1' } }, p, { soh: SOH }),
    );
    const issues = validate(order, p);
    const miss = issues.find(
      (i) => i.code === 'validate/required-field-missing' && i.refTagID === 55,
    );
    expect(miss?.layer).toBe('application');
  });

  it('an envelope-field problem on an app message is a SESSION finding', () => {
    const order = parsed(
      encode(
        { msgType: 'D', fields: { ...ENV_FIELDS, 52: 'not-a-time', 11: 'O1', 55: 'E', 54: '1' } },
        p,
        { soh: SOH },
      ),
    );
    const issues = validate(order, p);
    const bad = issues.find((i) => i.code === 'validate/invalid-value' && i.refTagID === 52);
    expect(bad?.layer).toBe('session');
  });

  it('a body enum violation on an app message is an APPLICATION finding', () => {
    const order = parsed(
      encode({ msgType: 'D', fields: { ...ENV_FIELDS, 11: 'O1', 55: 'E', 54: '1' } }, p, {
        soh: SOH,
      }),
    );
    order.fields[54] = { tag: 54, name: 'Side', raw: '~', value: '~' };
    const issues = validate(order, p);
    const bad = issues.find((i) => i.code === 'validate/value-not-in-enum' && i.refTagID === 54);
    expect(bad?.layer).toBe('application');
  });

  it('an unknown MsgType is an APPLICATION finding (BusinessMessageReject territory)', () => {
    const { message } = parse('8=FIXT.1.1|9=5|35=ZZ|49=A|56=B|34=1|10=000|', p, { soh: SOH });
    const issues = validate(message, p);
    const unknown = issues.find((i) => i.code === 'validate/unknown-msgtype');
    expect(unknown?.layer).toBe('application');
  });
});

describe('validate over a FIXT pair — ApplVerID resolver routing', () => {
  const resolverPair = (): FixtDictionaries => ({
    transport: transportDict(),
    app: appDict(),
    resolveApp: (applVerID) => (applVerID === '8' ? appDictSp1() : undefined),
    defaultApplVerID: '9',
  });

  it('routes a per-message ApplVerID(1128) to the resolver dictionary', () => {
    const p = resolverPair();
    // Under SP1 (which defines no NewOrderSingle) the same frame is an unknown MsgType.
    const wire = encode(
      { msgType: 'D', fields: { ...ENV_FIELDS, 1128: '8', 11: 'O1', 55: 'E', 54: '1' } },
      pair(), // encode against the SP2 pair so the frame itself is well-formed
      { soh: SOH },
    );
    const { message } = parse(wire, p, { soh: SOH });
    const issues = validate(message, p);
    const unknown = issues.find((i) => i.code === 'validate/unknown-msgtype');
    expect(unknown).toBeDefined();
    expect(unknown?.layer).toBe('application');
  });

  it('falls back to the default app dictionary when the resolver declines', () => {
    const p = resolverPair();
    const wire = encode(
      { msgType: 'D', fields: { ...ENV_FIELDS, 1128: '9', 11: 'O1', 55: 'E', 54: '1' } },
      p,
      { soh: SOH },
    );
    const { message, issues: parseIssues } = parse(wire, p, { soh: SOH });
    expect(errors(parseIssues)).toEqual([]);
    expect(validate(message, p)).toEqual([]); // resolveApp('9') → undefined → pair.app (SP2)
  });

  it('session messages are transport-routed regardless of the resolver', () => {
    const p = resolverPair();
    const wire = encode({ msgType: 'A', fields: { ...ENV_FIELDS, 108: 30, 1137: '8' } }, p, {
      soh: SOH,
    });
    const { message } = parse(wire, p, { soh: SOH });
    expect(validate(message, p)).toEqual([]);
  });
});

describe('createFixEngine over a FIXT pair', () => {
  it('exposes the merged dictionary plus both layers, and round-trips', () => {
    const engine = createFixEngine(pair(), { soh: SOH });
    expect(engine.transport?.beginString).toBe('FIXT.1.1');
    expect(engine.app?.version).toBe('FIX.5.0SP2');
    expect(engine.dictionary.version).toBe('FIX.5.0SP2');
    expect(engine.dictionary.beginString).toBe('FIXT.1.1');
    expect(engine.dictionary.applVerID).toBe('9');

    const wire = engine
      .create('A', { HeartBtInt: 30, DefaultApplVerID: '9' })
      .render(
        { SenderCompID: 'ME', TargetCompID: 'YOU', MsgSeqNum: 1, SendingTime: '20260801-12:00:00' },
        { soh: SOH },
      );
    expect(wire.startsWith('8=FIXT.1.1|')).toBe(true);
    const { message, issues } = engine.parse(wire);
    expect(errors(issues)).toEqual([]);
    expect(engine.validate(message)).toEqual([]);
  });

  it('a plain-dictionary engine carries no transport/app layers', () => {
    const engine = createFixEngine(transportDict());
    expect(engine.transport).toBeUndefined();
    expect(engine.app).toBeUndefined();
  });
});
