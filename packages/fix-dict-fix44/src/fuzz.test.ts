import { describe, expect, it } from 'vitest';
import {
  type EncodeMessage,
  type ParseResult,
  encode,
  loadDictionary,
  parse,
  parseAll,
  toEncodeMessage,
  validate,
} from '@boarteam/fix';
import { dictionary } from './index';

/**
 * The Tier-2 parser bar (PROJECT_PLAN M3): malformed input must produce diagnostics as data
 * and **never throw, crash, or hang**. This suite hammers `parse`/`parseAll`/`validate` with
 * truncated, reordered, bad-checksum, oversized, junk-tag, and fully-random inputs over the
 * real FIX 4.4 dictionary, plus a deterministic byte fuzzer. Determinism: a seeded LCG (no
 * `Math.random`) so a failure reproduces exactly.
 */

const dict = loadDictionary(dictionary);

/** A seeded linear-congruential RNG in [0, 1). Deterministic across runs. */
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const randInt = (rng: () => number, n: number): number => Math.floor(rng() * n);

/** A known-good Heartbeat frame to mutate (encode computes 8/9/10). */
function baseMessage(): string {
  const msg: EncodeMessage = {
    msgType: '0',
    fields: { 49: 'SENDER', 56: 'TARGET', 34: '1', 52: '20240115-12:30:00.000', 112: 'TEST-1' },
  };
  return encode(msg, dict, { soh: '|' });
}

/** Assert a parse never throws and yields the documented result shape. */
function expectSaneParse(input: string | Uint8Array, soh = '|'): ParseResult {
  let result!: ParseResult;
  expect(() => {
    result = parse(input, dict, { soh });
  }).not.toThrow();
  expect(result).toBeTruthy();
  expect(result.message).toBeTruthy();
  expect(Array.isArray(result.issues)).toBe(true);
  // validate must also be total on whatever structure came back.
  expect(() => validate(result.message, dict)).not.toThrow();
  return result;
}

describe('adversarial — round-trip identity (sanity anchor)', () => {
  it('the base message round-trips byte-stably and validates clean', () => {
    const base = baseMessage();
    const { message, issues } = parse(base, dict, { soh: '|' });
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
    const reencoded = encode(toEncodeMessage(message), dict, { soh: '|' });
    expect(reencoded).toBe(base);
    expect(validate(message, dict).filter((i) => i.severity === 'error')).toEqual([]);
  });
});

describe('adversarial — targeted mutations', () => {
  const base = baseMessage();

  it('survives truncation at every byte offset', () => {
    for (let i = 0; i <= base.length; i++) {
      expectSaneParse(base.slice(0, i));
    }
  });

  it('survives single-character corruption at every offset', () => {
    for (let i = 0; i < base.length; i++) {
      const mutated = base.slice(0, i) + '#' + base.slice(i + 1);
      expectSaneParse(mutated);
    }
  });

  it('survives reordered fields', () => {
    const parts = base.split('|').filter(Boolean);
    const rng = makeRng(7);
    for (let trial = 0; trial < 200; trial++) {
      const shuffled = [...parts];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = randInt(rng, i + 1);
        [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
      }
      expectSaneParse(shuffled.join('|') + '|');
    }
  });

  it('survives a corrupted checksum and body length', () => {
    expectSaneParse(base.replace(/10=\d{3}/, '10=999'));
    expectSaneParse(base.replace(/9=\d+/, '9=999999'));
    expectSaneParse(base.replace(/9=\d+/, '9=0'));
    expectSaneParse(base.replace(/9=\d+/, '9=notanumber'));
  });

  it('survives junk tags and segments', () => {
    const junk = [
      'abc=def',
      '=novalue',
      '99999999=x',
      '-1=neg',
      '0=zero',
      '35',
      '====',
      '268=notnum',
      'tag=with=equals',
    ];
    for (const j of junk) {
      expectSaneParse(`8=FIX.4.4|9=5|35=0|${j}|10=000|`);
      expectSaneParse(`${j}|${j}|${j}|`);
    }
  });

  it('survives oversized group counters without allocating', () => {
    // A declared count of 100M with no entries must be O(1): no attempt to materialise entries.
    const started = performance.now();
    const r = expectSaneParse(`8=FIX.4.4|9=5|35=W|262=R|268=100000000|10=000|`);
    expect(performance.now() - started).toBeLessThan(500);
    expect(r.issues.some((i) => i.code === 'parse/group-count-mismatch')).toBe(true);
  });

  it('handles a genuinely large number of real group entries linearly', () => {
    const n = 20000;
    const entries: string[] = [];
    for (let i = 0; i < n; i++) {
      entries.push(`269=0`, `270=1.5`);
    }
    const wire = `8=FIX.4.4|9=5|35=W|262=R|268=${n}|${entries.join('|')}|10=000|`;
    const started = performance.now();
    const result = expectSaneParse(wire);
    expect(performance.now() - started).toBeLessThan(2000);
    expect(result.message.groups[268]?.length).toBe(n);
  });

  it('survives deeply repeated separators and equals signs', () => {
    expectSaneParse('|'.repeat(5000));
    expectSaneParse('='.repeat(5000));
    expectSaneParse(('8=FIX.4.4|' + '='.repeat(1000) + '|').repeat(10));
  });
});

describe('adversarial — random byte fuzzing', () => {
  it('never throws on random byte buffers (Uint8Array)', () => {
    const rng = makeRng(1234);
    for (let trial = 0; trial < 1500; trial++) {
      const len = randInt(rng, 600);
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = randInt(rng, 256);
      }
      expect(() => parse(bytes, dict, { soh: '|' })).not.toThrow();
      expect(() => parseAll(bytes, dict, { soh: '|' })).not.toThrow();
      const { message } = parse(bytes, dict, { soh: '|' });
      expect(() => validate(message, dict)).not.toThrow();
    }
  });

  it('never throws on random SOH-delimited field streams', () => {
    const rng = makeRng(98765);
    const alphabet = '0123456789ABCDEFXYZ.-+ =|';
    const randToken = (): string => {
      const len = randInt(rng, 12);
      let s = '';
      for (let i = 0; i < len; i++) {
        s += alphabet[randInt(rng, alphabet.length)];
      }
      return s;
    };
    for (let trial = 0; trial < 1500; trial++) {
      const nFields = randInt(rng, 40);
      const segments: string[] = [];
      for (let i = 0; i < nFields; i++) {
        const tag = rng() < 0.7 ? `${randInt(rng, 1000)}` : randToken();
        segments.push(`${tag}=${randToken()}`);
      }
      const wire = segments.join('|');
      expectSaneParse(wire);
      expect(() => parseAll(wire, dict, { soh: '|' })).not.toThrow();
    }
  });

  it('never throws on mutated copies of the base message', () => {
    const base = baseMessage();
    const rng = makeRng(424242);
    const bytes = new TextEncoder().encode(base);
    for (let trial = 0; trial < 2000; trial++) {
      const copy = bytes.slice();
      const edits = 1 + randInt(rng, 8);
      for (let e = 0; e < edits; e++) {
        copy[randInt(rng, copy.length)] = randInt(rng, 256);
      }
      expect(() => parse(copy, dict, { soh: '|' })).not.toThrow();
      const { message } = parse(copy, dict, { soh: '|' });
      expect(() => validate(message, dict)).not.toThrow();
    }
  });
});

describe('adversarial — parseAll on concatenated and broken streams', () => {
  it('never throws on many concatenated frames, valid or not', () => {
    const base = baseMessage();
    const rng = makeRng(55);
    for (let trial = 0; trial < 300; trial++) {
      const count = randInt(rng, 6);
      let stream = '';
      for (let i = 0; i < count; i++) {
        stream += rng() < 0.5 ? base : base.slice(0, randInt(rng, base.length));
      }
      let results!: ParseResult[];
      expect(() => {
        results = parseAll(stream, dict, { soh: '|' });
      }).not.toThrow();
      expect(Array.isArray(results)).toBe(true);
      for (const r of results) {
        expect(() => validate(r.message, dict)).not.toThrow();
      }
    }
  });
});
