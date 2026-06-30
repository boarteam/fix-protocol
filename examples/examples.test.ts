// Keeps the README/examples honest: CI runs every example and asserts it works against the
// real published API. If an example drifts from the API, this fails.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createFixEngine } from '@boarteam/fix';
import { dictionary } from '@boarteam/fix-dict-fix44';
import { run as runParseAndValidate } from './parse-and-validate.mjs';
import { run as runEncode } from './encode-a-message.mjs';
import { run as runDemo } from './demo-decode.mjs';

describe('examples', () => {
  it('parse-and-validate decodes the repeating group', () => {
    const result = runParseAndValidate();
    expect(result.msgType).toBe('W');
    expect(result.entries).toBe(2);
  });

  it('encode-a-message produces a framed, re-parseable message', () => {
    const wire = runEncode();
    expect(wire.startsWith('8=FIX.4.4')).toBe(true);
    expect(wire).toContain('35=D');
    expect(wire.endsWith('\x01')).toBe(true);
    expect(wire).toMatch(/\x0110=\d{3}\x01$/); // a 3-digit checksum trailer
  });

  // Pins the recorded demo GIF to reality: these are the exact facts the recording shows, so
  // a drift in engine output fails CI and signals the GIF needs re-rendering (re-run
  // `scripts/render-demo.sh` after changing examples/demo-decode.mjs).
  it('demo-decode: the clean snapshot parses + validates with zero issues', () => {
    const r = runDemo('snapshot');
    expect(r.msgType).toBe('W');
    expect(r.name).toBe('MarketDataSnapshotFullRefresh');
    expect(r.framed).toBe(true);
    expect(r.groupEntries).toBe(2);
    expect(r.issueCodes).toEqual([]);
    expect(r.problemCodes).toEqual([]);
  });

  it('demo-decode: the malformed report still parses, returning every defect as data', () => {
    const r = runDemo('broken');
    expect(r.msgType).toBe('8');
    expect(r.name).toBe('ExecutionReport');
    expect(r.framed).toBe(true); // it never throws — the defects come back as issues, not exceptions
    expect(r.issueCodes).toContain('parse/invalid-float');
    expect(r.issueCodes).toContain('parse/checksum-mismatch');
    expect(r.problemCodes).toContain('validate/value-not-in-enum');
  });

  // Pins the EXACT raw shown in README.md's first code block, where SOH is written as `|` and
  // passed via `{ soh: '|' }`. CheckSum 248 is correct for the |-byte wire (195 is the SOH-byte
  // value the GIF demo uses). This guards the doc from drift and against "correcting" 248 -> 195,
  // which would actually break the checksum for a |-separated message.
  it('README aha-block: the |-separated snapshot (10=248) parses + validates clean', () => {
    const fix = createFixEngine(dictionary);
    const raw =
      '8=FIX.4.4|9=130|35=W|49=SENDER|56=TARGET|34=2|52=20240101-12:00:00.000|' +
      '55=EUR/USD|268=2|269=0|270=1.0921|271=1000000|269=1|270=1.0923|271=1000000|10=248';
    const { message, issues } = fix.parse(raw, { soh: '|' });
    expect(message.msgType).toBe('W');
    expect(issues).toEqual([]);
    expect(fix.validate(message)).toEqual([]);
  });

  // Pins the exact `.fix` sample files the demo recording pipes in (`|`-delimited for
  // readability, decoded via the script's separator auto-detect). If a sample drifts, the
  // GIF would show stale output and CI fails here first.
  it('demo samples: trade.fix decodes clean; corrupt.fix returns every defect as data', () => {
    const fix = createFixEngine(dictionary);
    const read = (name) =>
      readFileSync(new URL(`./samples/${name}`, import.meta.url), 'utf8').trim();

    const clean = fix.parse(read('trade.fix'), { soh: '|' });
    expect(clean.message.msgType).toBe('W');
    expect(clean.issues).toEqual([]);
    expect(fix.validate(clean.message)).toEqual([]);

    const broken = fix.parse(read('corrupt.fix'), { soh: '|' });
    expect(broken.message.msgType).toBe('8');
    const codes = broken.issues.map((i) => i.code);
    expect(codes).toContain('parse/invalid-float');
    expect(codes).toContain('parse/checksum-mismatch');
    expect(fix.validate(broken.message).map((p) => p.code)).toContain('validate/value-not-in-enum');
  });
});
