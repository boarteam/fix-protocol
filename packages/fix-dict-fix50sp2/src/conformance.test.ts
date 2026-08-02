import { describe, expect, it } from 'vitest';
import {
  createFixEngine,
  encode,
  loadDictionary,
  parse,
  toEncodeMessage,
  validate,
} from '@boarteam/fix';
import { dictionary as fixt11 } from '@boarteam/fix-dict-fixt11';
import { dictionary } from './index';

/**
 * Phase 6 conformance evidence (docs/fix5-plan.md): byte-pinned golden fixtures, the
 * FIX 5.0 datatype vectors, and the transport/application pair over the REAL generated
 * dictionaries. The same golden frames are validated by quickfix-go's fixtValidator in the
 * generator repo (`fix-codegen/crossengine/` — all accepted, 2026-08-02), so these literals
 * double as the cross-engine contract: if `encode` drifts from them, interop was broken.
 */

const dict = loadDictionary(dictionary);
const SOH = '\x01';
const soh = (s: string) => s.replace(/\|/g, SOH);

// The golden FIXT.1.1 frame set — byte-for-byte, checksums included (see
// fix-codegen/crossengine/frames.txt). Session set + app messages under the FIXT envelope.
const GOLDEN = {
  logon: soh(
    '8=FIXT.1.1|9=79|35=A|49=INITIATOR|56=ACCEPTOR|34=1|52=20260801-12:00:00.000|98=0|108=30|1137=9|10=129|',
  ),
  heartbeat: soh(
    '8=FIXT.1.1|9=71|35=0|49=INITIATOR|56=ACCEPTOR|34=2|52=20260801-12:00:00.000|112=PING-1|10=107|',
  ),
  testRequest: soh(
    '8=FIXT.1.1|9=71|35=1|49=INITIATOR|56=ACCEPTOR|34=3|52=20260801-12:00:00.000|112=PING-2|10=110|',
  ),
  reject: soh(
    '8=FIXT.1.1|9=125|35=3|49=INITIATOR|56=ACCEPTOR|34=4|52=20260801-12:00:00.000|45=2|371=55|372=D|373=2|58=Tag not defined for this message type|10=214|',
  ),
  executionReport: soh(
    '8=FIXT.1.1|9=130|35=8|1128=9|49=INITIATOR|56=ACCEPTOR|34=5|52=20260801-12:00:00.000|37=ORD-1|17=EXEC-1|150=0|39=0|55=EURUSD|54=1|151=1000|14=0|6=0|10=222|',
  ),
  marketData: soh(
    '8=FIXT.1.1|9=145|35=W|49=INITIATOR|56=ACCEPTOR|34=6|52=20260801-12:00:00.000|262=REQ-1|55=EURUSD|268=2|269=0|270=1.10500|271=1000000|269=1|270=1.10520|271=750000|10=190|',
  ),
};

const ENV = { 49: 'INITIATOR', 56: 'ACCEPTOR', 52: '20260801-12:00:00.000' };

describe('golden FIXT.1.1 fixtures — encode reproduces the pinned bytes', () => {
  it('Logon with DefaultApplVerID=9', () => {
    expect(
      encode({ msgType: 'A', fields: { ...ENV, 34: 1, 98: '0', 108: 30, 1137: '9' } }, dict),
    ).toBe(GOLDEN.logon);
  });

  it('Heartbeat and TestRequest', () => {
    expect(encode({ msgType: '0', fields: { ...ENV, 34: 2, 112: 'PING-1' } }, dict)).toBe(
      GOLDEN.heartbeat,
    );
    expect(encode({ msgType: '1', fields: { ...ENV, 34: 3, 112: 'PING-2' } }, dict)).toBe(
      GOLDEN.testRequest,
    );
  });

  it('session Reject with reference fields', () => {
    expect(
      encode(
        {
          msgType: '3',
          fields: {
            ...ENV,
            34: 4,
            45: 2,
            371: 55,
            372: 'D',
            373: '2',
            58: 'Tag not defined for this message type',
          },
        },
        dict,
      ),
    ).toBe(GOLDEN.reject);
  });

  it('ExecutionReport with the per-message ApplVerID(1128) header override', () => {
    expect(
      encode(
        {
          msgType: '8',
          fields: {
            ...ENV,
            34: 5,
            1128: '9',
            37: 'ORD-1',
            17: 'EXEC-1',
            150: '0',
            39: '0',
            55: 'EURUSD',
            54: '1',
            151: '1000',
            14: '0',
            6: '0',
          },
        },
        dict,
      ),
    ).toBe(GOLDEN.executionReport);
    // The FIXT header places 1128 immediately after MsgType(35), before the comp IDs.
    expect(GOLDEN.executionReport.startsWith(soh('8=FIXT.1.1|9=130|35=8|1128=9|49='))).toBe(true);
  });

  it('MarketDataSnapshotFullRefresh with a 2-entry NoMDEntries group', () => {
    expect(
      encode(
        {
          msgType: 'W',
          fields: { ...ENV, 34: 6, 262: 'REQ-1', 55: 'EURUSD' },
          groups: {
            268: [
              { fields: { 269: '0', 270: '1.10500', 271: '1000000' } },
              { fields: { 269: '1', 270: '1.10520', 271: '750000' } },
            ],
          },
        },
        dict,
      ),
    ).toBe(GOLDEN.marketData);
  });

  it('every golden frame decodes clean and re-encodes byte-stably', () => {
    for (const [name, wire] of Object.entries(GOLDEN)) {
      const { message, issues } = parse(wire, dict);
      expect(
        issues.filter((i) => i.severity === 'error'),
        name,
      ).toEqual([]);
      expect(
        validate(message, dict).filter((i) => i.severity === 'error'),
        name,
      ).toEqual([]);
      expect(encode(toEncodeMessage(message), dict), name).toBe(wire);
    }
  });
});

describe('FIX 5.0 datatype conformance vectors', () => {
  /** validate a single top-level field value on a Heartbeat carrier message. */
  function fieldIssues(tag: number, raw: string) {
    const f = dict.fieldByTag(tag)!;
    const message = parse(GOLDEN.heartbeat, dict).message;
    message.fields[tag] = { tag, name: f.name, raw, value: raw };
    return validate(message, dict).filter((i) => i.refTagID === tag);
  }

  it('TZTimeOnly (MaturityTime 1079): accepts zone designators, rejects junk', () => {
    for (const good of [
      '12:30',
      '12:30Z',
      '12:30:05',
      '12:30:05.250',
      '12:30+02:00',
      '12:30:05-05',
    ]) {
      expect(fieldIssues(1079, good), good).toEqual([]);
    }
    // Shape violations only: the engine's time formats are lexical checks, not range
    // checks (25:99 passes, matching the lenient UTC_TIME_RE stance).
    for (const bad of ['noon', '12', '1:30', '12:30:05+2', '12:30:05Z+02']) {
      expect(
        fieldIssues(1079, bad).some((i) => i.code === 'validate/invalid-value'),
        bad,
      ).toBe(true);
    }
  });

  it('TZTimestamp (TransBkdTime 483 is UTC; use a TZ field): vectors on 1132 TZTransactTime', () => {
    const f = dict.fieldByTag(1132)!;
    expect(f.type).toBe('TZTimestamp');
    for (const good of ['20260801-12:30', '20260801-12:30:05Z', '20260801-12:30:05.123+02:00']) {
      expect(fieldIssues(1132, good), good).toEqual([]);
    }
    for (const bad of ['2026-08-01T12:30:05Z', '20260801 12:30', 'yesterday']) {
      expect(
        fieldIssues(1132, bad).some((i) => i.code === 'validate/invalid-value'),
        bad,
      ).toBe(true);
    }
  });

  it('MultipleCharValue (ExecInst 18) validates per single-char token', () => {
    expect(fieldIssues(18, '1 2 6')).toEqual([]);
    expect(fieldIssues(18, '1 ~ 6').some((i) => i.code === 'validate/value-not-in-enum')).toBe(
      true,
    );
  });

  it('MultipleStringValue (TradeCondition 277) validates per multi-char token', () => {
    expect(fieldIssues(277, 'A AJ')).toEqual([]);
    expect(fieldIssues(277, 'A NOPE').some((i) => i.code === 'validate/value-not-in-enum')).toBe(
      true,
    );
  });

  it('Language (LanguageCode): ISO 639-1 heuristic warns on non-codes', () => {
    const langField = Object.values(dictionary.fields).find((f) => f.type === 'Language')!;
    expect(langField.name).toBe('LanguageCode');
    expect(fieldIssues(langField.tag, 'en')).toEqual([]);
    const bad = fieldIssues(langField.tag, 'english');
    expect(bad.some((i) => i.code === 'validate/invalid-value' && i.severity === 'warning')).toBe(
      true,
    );
  });

  it('XmlData(213) + XmlDataLen(212): a data value may embed the separator', () => {
    const payload = `<x>${SOH}</x>`;
    const byteLen = new TextEncoder().encode(payload).length;
    // 212/213 are FIXT header fields, so any message carries them; use a Heartbeat.
    const wire = encode(
      { msgType: '0', fields: { ...ENV, 34: 9, 212: byteLen, 213: payload } },
      dict,
    );
    const { message, issues } = parse(wire, dict);
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(message.fields[213]?.raw).toBe(payload); // SOH-embedding payload survives intact
    expect(validate(message, dict).filter((i) => i.severity === 'error')).toEqual([]);
    // Dropping the Length companion of a present data field is conditionally-required.
    const noLen = parse(wire, dict).message;
    delete noLen.fields[212];
    expect(
      validate(noLen, dict).some(
        (i) => i.code === 'validate/conditional-required' && i.refTagID === 212,
      ),
    ).toBe(true);
  });
});

describe('transport/application pair over the REAL generated dictionaries', () => {
  const pair = { transport: fixt11, app: dictionary };
  const engine = createFixEngine(pair);

  it('binds the layers: fixt11 transport, fix50sp2 app, merged view intact', () => {
    expect(engine.transport?.version).toBe('FIXT.1.1');
    expect(engine.app?.version).toBe('FIX.5.0SP2');
    expect(engine.dictionary.beginString).toBe('FIXT.1.1');
    expect(engine.dictionary.applVerID).toBe('9');
  });

  it('every golden frame parses + validates clean through the pair', () => {
    for (const [name, wire] of Object.entries(GOLDEN)) {
      const { message, issues } = engine.parse(wire);
      expect(
        issues.filter((i) => i.severity === 'error'),
        name,
      ).toEqual([]);
      expect(
        engine.validate(message).filter((i) => i.severity === 'error'),
        name,
      ).toEqual([]);
    }
  });

  it('layer attribution: session findings on the session set, application on app bodies', () => {
    // Drop the required DefaultApplVerID from the golden Logon → a SESSION finding.
    const logon = engine.parse(GOLDEN.logon).message;
    delete logon.fields[1137];
    const logonIssues = engine.validate(logon);
    const miss = logonIssues.find(
      (i) => i.code === 'validate/required-field-missing' && i.refTagID === 1137,
    );
    expect(miss?.layer).toBe('session');

    // Drop the required OrderID from the golden ExecutionReport → an APPLICATION finding.
    const er = engine.parse(GOLDEN.executionReport).message;
    delete er.fields[37];
    const erIssues = engine.validate(er);
    const missOrder = erIssues.find(
      (i) => i.code === 'validate/required-field-missing' && i.refTagID === 37,
    );
    expect(missOrder?.layer).toBe('application');

    // A malformed SendingTime on the app message is an ENVELOPE (session) finding.
    const badTime = engine.parse(GOLDEN.executionReport).message;
    badTime.fields[52] = { tag: 52, name: 'SendingTime', raw: 'not-a-time', value: 'not-a-time' };
    const timeIssue = engine
      .validate(badTime)
      .find((i) => i.code === 'validate/invalid-value' && i.refTagID === 52);
    expect(timeIssue?.layer).toBe('session');
  });

  it('an application-layer field on a session message is flagged for a session Reject', () => {
    const hb = engine.parse(GOLDEN.heartbeat).message;
    hb.fields[55] = { tag: 55, name: 'Symbol', raw: 'EURUSD', value: 'EURUSD' };
    const outside = engine.validate(hb).find((i) => i.code === 'validate/field-outside-layer');
    expect(outside).toMatchObject({ refTagID: 55, layer: 'session', sessionRejectReason: 2 });
  });
});
