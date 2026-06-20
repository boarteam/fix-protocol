import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadDictionary, validateDictionary } from '@boarteam/fix';
import { emitDictionaryJson } from './emit';
import { generate } from './generate';

// A committed miniature spec tree, so generate()'s integration (datatypes + fields +
// structure) and idempotency are verifiable in any checkout, without the external repo.
const FIXTURE = fileURLToPath(new URL('../test-fixtures/spec', import.meta.url));

describe('generate (committed fixture spec)', () => {
  it('integrates datatypes, fields, components, and a grouped message', () => {
    const { dictionary } = generate(FIXTURE);
    expect(Object.keys(dictionary.datatypes).length).toBe(4);
    expect(Object.keys(dictionary.fields).length).toBe(8);
    expect(Object.keys(dictionary.components).length).toBe(2);
    expect(dictionary.messages.length).toBe(1);
    expect(validateDictionary(dictionary).filter((i) => i.severity === 'error')).toEqual([]);

    const dict = loadDictionary(dictionary);
    const z = dict.messageByMsgType('Z')!;
    expect(z.name).toBe('Sample Message');
    expect(z.category).toBe('app');
    expect(z.members[0]).toMatchObject({ kind: 'component', name: 'Standard Message Header' });
    expect(z.members.at(-1)).toMatchObject({ kind: 'component', name: 'Standard Message Trailer' });
    const group = z.members.find((m) => m.kind === 'group')!;
    expect(group).toMatchObject({ kind: 'group', counterTag: 267 });
    expect(dict.groupDelimiterTag(group as never)).toBe(269);
    expect(dictionary.fields[269]!.enumValues).toHaveLength(3); // Bid/Offer/Trade, unwrapped
  });

  it('is idempotent: regeneration yields byte-identical JSON', () => {
    expect(emitDictionaryJson(generate(FIXTURE).dictionary)).toBe(
      emitDictionaryJson(generate(FIXTURE).dictionary),
    );
  });
});

// The full FIX 4.4 Markdown reference lives in a sibling repo; gate on its presence so the
// suite still runs where it is absent (e.g. a fresh CI checkout without the spec).
const SPEC_DIR = process.env.FIX_SPEC_DIR ?? '/Users/dev/projects/fix';
const present = existsSync(SPEC_DIR);

describe.skipIf(!present)('generate (end-to-end over the FIX 4.4 Markdown reference)', () => {
  it('produces the full surface that validates without errors', () => {
    const { dictionary } = generate(SPEC_DIR);
    expect(Object.keys(dictionary.fields).length).toBe(912);
    expect(Object.keys(dictionary.components).length).toBe(26);
    expect(dictionary.messages.length).toBe(93);
    expect(validateDictionary(dictionary).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('is idempotent: regeneration yields byte-identical JSON', () => {
    expect(emitDictionaryJson(generate(SPEC_DIR).dictionary)).toBe(
      emitDictionaryJson(generate(SPEC_DIR).dictionary),
    );
  });

  it('records only the two honest coverage-gap kinds', () => {
    const { gaps } = generate(SPEC_DIR);
    expect(gaps.every((g) => g.kind === 'unresolved-group' || g.kind === 'approximate-group')).toBe(
      true,
    );
  });
});
