import { describe, expect, it } from 'vitest';
import { SOH, tokenize } from './tokenize';

const f = (s: string) => s.replace(/\|/g, SOH);

describe('tokenize', () => {
  it('splits a framed message into ordered [tag, value] pairs', () => {
    const raw = f('8=FIX.4.4|9=12|35=A|108=30|10=000|');
    expect(tokenize(raw)).toEqual([
      [8, 'FIX.4.4'],
      [9, '12'],
      [35, 'A'],
      [108, '30'],
      [10, '000'],
    ]);
  });

  it('preserves field order and keeps duplicate tags as separate entries', () => {
    // Repeating group: two NoMDEntryTypes (269) members must both survive, in order.
    const raw = f('35=V|267=2|269=0|269=1|');
    expect(tokenize(raw)).toEqual([
      [35, 'V'],
      [267, '2'],
      [269, '0'],
      [269, '1'],
    ]);
  });

  it('keeps "=" inside a value (indexOf, not split)', () => {
    const raw = f('35=B|58=a=b=c|');
    expect(tokenize(raw)).toEqual([
      [35, 'B'],
      [58, 'a=b=c'],
    ]);
  });

  it('allows an empty value', () => {
    expect(tokenize(f('58=|'))).toEqual([[58, '']]);
  });

  it('decodes Uint8Array input as UTF-8', () => {
    const bytes = new TextEncoder().encode(f('35=B|58=Müller|'));
    expect(tokenize(bytes)).toEqual([
      [35, 'B'],
      [58, 'Müller'],
    ]);
  });

  it('accepts a custom separator for pipe-delimited logs', () => {
    expect(tokenize('8=FIX.4.4|9=5|35=0|', { soh: '|' })).toEqual([
      [8, 'FIX.4.4'],
      [9, '5'],
      [35, '0'],
    ]);
  });

  it('returns an empty array for empty input', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize(new Uint8Array())).toEqual([]);
  });

  it('does not emit a trailing empty token, and tolerates doubled separators', () => {
    expect(tokenize(f('35=A||108=30|'))).toEqual([
      [35, 'A'],
      [108, '30'],
    ]);
  });

  it('flags a segment with no "=" as a NaN tag rather than dropping it', () => {
    const [first, second] = tokenize(f('35=A|garbage|'));
    expect(first).toEqual([35, 'A']);
    expect(second![0]).toBeNaN();
    expect(second![1]).toBe('garbage');
  });

  it('flags a non-numeric tag as NaN without throwing', () => {
    expect(tokenize(f('3x=A|'))[0]![0]).toBeNaN();
    expect(tokenize(f('1.5=A|'))[0]![0]).toBeNaN();
    expect(tokenize(f(' 8=FIX.4.4|'))[0]![0]).toBeNaN();
  });
});
