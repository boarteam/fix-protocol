// @vitest-environment happy-dom
//
// Browser-environment smoke test: the full engine + full FIX 4.2 dictionary must parse,
// validate, and encode inside a DOM runtime (no Node globals). Run under happy-dom so CI
// proves the "browser + Node" claim, not just Node.
import { describe, expect, it } from 'vitest';
import { createFixEngine } from '@boarteam/fix';
import { MsgType, Tags, dictionary } from './index';

describe('browser environment (happy-dom)', () => {
  it('runs in a DOM runtime without Node globals', () => {
    // Sanity: we really are in a browser-like environment here. Reach `window` via
    // `globalThis` so the assertion type-checks without pulling the DOM lib into this
    // data-only package's tsconfig.
    const g = globalThis as Record<string, unknown>;
    expect(typeof g.window).not.toBe('undefined');
    expect(typeof TextEncoder).toBe('function');
    expect(typeof TextDecoder).toBe('function');
  });

  it('parses, validates, and re-encodes a Logon round-trip', () => {
    const fix = createFixEngine(dictionary);
    const SOH = '\x01';
    const raw = [
      '8=FIX.4.2',
      '9=0',
      `35=${MsgType.Logon}`,
      '49=SENDER',
      '56=TARGET',
      '34=1',
      '52=20240101-00:00:00.000',
      `${Tags.EncryptMethod}=0`,
      `${Tags.HeartBtInt}=30`,
      '10=000',
    ].join(SOH);

    const { message, issues } = fix.parse(raw);
    expect(message.msgType).toBe(MsgType.Logon);
    // Parsing never throws; issues are returned data.
    expect(Array.isArray(issues)).toBe(true);

    const problems = fix.validate(message);
    expect(Array.isArray(problems)).toBe(true);

    const wire = fix.encode({
      msgType: MsgType.Logon,
      fields: {
        [Tags.SenderCompID]: 'SENDER',
        [Tags.TargetCompID]: 'TARGET',
        [Tags.MsgSeqNum]: '1',
        [Tags.SendingTime]: '20240101-00:00:00.000',
        [Tags.EncryptMethod]: '0',
        [Tags.HeartBtInt]: '30',
      },
    });
    expect(wire).toContain(`35=${MsgType.Logon}`);
    expect(wire.endsWith(SOH)).toBe(true);
    // Byte-accurate framing produced a valid checksum the parser accepts.
    const reparsed = fix.parse(wire);
    expect(reparsed.issues.filter((i) => i.code === 'checksum-mismatch')).toEqual([]);
  });
});
