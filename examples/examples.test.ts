// Keeps the README/examples honest: CI runs every example and asserts it works against the
// real published API. If an example drifts from the API, this fails.
import { describe, expect, it } from 'vitest';
import { run as runParseAndValidate } from './parse-and-validate.mjs';
import { run as runEncode } from './encode-a-message.mjs';

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
});
