import { describe, expect, it } from 'vitest';
import { bodyLength, calculateChecksum } from './checksum';

const SOH = '\x01';

describe('calculateChecksum', () => {
  it('matches a hand-verifiable byte sum', () => {
    // bytes: '3'(51) '5'(53) '='(61) 'A'(65) SOH(1) = 231
    expect(calculateChecksum(`35=A${SOH}`)).toBe('231');
  });

  it('zero-pads to three digits and matches the exact value for a realistic fragment', () => {
    expect(calculateChecksum('')).toBe('000');
    // Golden value (byte-sum mod 256) for a real FIX header fragment — constrains the
    // value, not just the digit count.
    expect(calculateChecksum(`8=FIX.4.4${SOH}9=5${SOH}35=0${SOH}`)).toBe('163');
  });

  it('wraps modulo 256', () => {
    // 0x80 + 0x80 = 256 -> 0
    expect(calculateChecksum(new Uint8Array([0x80, 0x80]))).toBe('000');
    // 0xFF + 0x02 = 257 -> 1
    expect(calculateChecksum(new Uint8Array([0xff, 0x02]))).toBe('001');
  });

  it('is byte-accurate for non-ASCII values (string and Uint8Array agree)', () => {
    const text = 'Müller'; // "ü" is two UTF-8 bytes
    const viaBytes = calculateChecksum(new TextEncoder().encode(text));
    expect(calculateChecksum(text)).toBe(viaBytes);
  });
});

describe('bodyLength', () => {
  it('counts UTF-8 bytes, not string code units', () => {
    const text = 'Müller';
    expect(bodyLength(text)).toBe(7); // M, ü(2 bytes), l, l, e, r
    expect(text.length).toBe(6); // JS string length would be wrong on the wire
  });

  it('measures a framed body in bytes', () => {
    const body = `35=A${SOH}108=30${SOH}`;
    expect(bodyLength(body)).toBe(body.length); // ASCII: bytes === code units
  });
});
