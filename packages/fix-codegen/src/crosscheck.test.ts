import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { DictionaryJSON, MemberRef } from '@boarteam/fix';
import { describe, expect, it } from 'vitest';
import { generate } from './generate';
import { parseQuickFix } from './quickfix';
import { type Baseline, baselineSignatures, crossCheck } from './crosscheck';

const XML_PATH = fileURLToPath(new URL('../vendor/quickfix/FIX44.xml', import.meta.url));
const DICT_PATH = fileURLToPath(
  new URL('../../fix-dict-fix44/src/dictionary.json', import.meta.url),
);
const BASELINE_PATH = fileURLToPath(new URL('../crosscheck-baseline.json', import.meta.url));

const xml = parseQuickFix(readFileSync(XML_PATH, 'utf8'));
const committed = JSON.parse(readFileSync(DICT_PATH, 'utf8')) as DictionaryJSON;
const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Baseline;
const sigs = baselineSignatures(baseline);

const clone = (d: DictionaryJSON): DictionaryJSON =>
  JSON.parse(JSON.stringify(d)) as DictionaryJSON;

describe('cross-check drift gate (committed dictionary vs QuickFIX FIX44.xml)', () => {
  const result = crossCheck(committed, xml, sigs);

  it('matches the committed baseline — no unexpected drift, no stale entries', () => {
    if (result.unexpected.length > 0) {
      throw new Error(
        `Unexpected cross-check differences (drift):\n` +
          result.unexpected
            .slice(0, 20)
            .map((d) => `  [${d.cluster}] ${d.category} ${d.key}: ${d.detail}`)
            .join('\n'),
      );
    }
    expect(result.unexpected).toEqual([]);
    expect(result.resolved).toEqual([]);
  });

  it('every baseline entry carries a documented cluster', () => {
    const clusters = new Set(baseline.entries.map((e) => e.cluster));
    expect(clusters.has('unknown')).toBe(false);
    expect(baseline.entries.length).toBeGreaterThan(0);
  });

  it('catches a renamed field (value-bearing, not just tag-pinned)', () => {
    const mutated = clone(committed);
    mutated.fields[55]!.name = 'Symbool';
    const r = crossCheck(mutated, xml, sigs);
    expect(r.unexpected).toContainEqual(
      expect.objectContaining({ category: 'field-name', key: '55' }),
    );
  });

  it('catches a renamed field even on a PINNED alias tag (changed difference)', () => {
    // tag 23 (IOIid/IOIID) is an accepted alias; a *different* rename must still fail.
    const mutated = clone(committed);
    mutated.fields[23]!.name = 'Totally Different';
    const r = crossCheck(mutated, xml, sigs);
    expect(r.unexpected.some((d) => d.category === 'field-name' && d.key === '23')).toBe(true);
    // and the original alias signature is now stale/resolved
    expect(r.resolved.some((s) => s.startsWith('field-name|23|'))).toBe(true);
  });

  it('CRITICAL: catches an optionality regression (a required field flipped to optional)', () => {
    // Pick a top-level field of NewOrderSingle (D) that BOTH sources mark required, then drop
    // its required flag in the Markdown side. The pre-fix blanket rule silently accepted this.
    const mutated = clone(committed);
    const d = mutated.messages.find((m) => m.msgType === 'D')!;
    const xmlD = xml.messages.find((m) => m.msgType === 'D')!;
    const xmlRequired = new Set(
      xmlD.members
        .filter((m): m is MemberRef & { kind: 'field' } => m.kind === 'field' && m.reqd === 'Y')
        .map((m) => m.tag),
    );
    const target = d.members.find(
      (m): m is MemberRef & { kind: 'field' } =>
        m.kind === 'field' && m.reqd === 'Y' && xmlRequired.has(m.tag),
    );
    expect(target).toBeDefined();
    target!.reqd = 'N';
    const r = crossCheck(mutated, xml, sigs);
    expect(r.unexpected.some((u) => u.category === 'message-reqd' && u.key === 'D')).toBe(true);
  });

  it('catches a field inserted into a message structure', () => {
    const mutated = clone(committed);
    const d = mutated.messages.find((m) => m.msgType === 'D')!;
    d.members.push({ kind: 'field', tag: 100, reqd: 'N' }); // ExDestination, not normally in D
    const r = crossCheck(mutated, xml, sigs);
    expect(r.unexpected.some((u) => u.category === 'message-structure' && u.key === 'D')).toBe(
      true,
    );
  });

  it('surfaces a Markdown dictionary that defines an excluded deprecated field', () => {
    const mutated = clone(committed);
    mutated.fields[201] = { tag: 201, name: 'PutOrCall', type: 'int' };
    const r = crossCheck(mutated, xml, sigs);
    expect(r.unexpected.some((u) => u.signature === 'ignored-field-defined|201')).toBe(true);
  });
});

// When the upstream Markdown spec is checked out, the *freshly generated* dictionary must
// also match the baseline — i.e. regeneration would not introduce drift.
const SPEC_DIR = process.env.FIX_SPEC_DIR ?? '/Users/dev/projects/fix';

describe.skipIf(!existsSync(SPEC_DIR))('cross-check on a freshly generated dictionary', () => {
  it('regenerating from the Markdown spec stays within the baseline', () => {
    const { dictionary } = generate(SPEC_DIR);
    const r = crossCheck(dictionary, xml, sigs);
    expect(r.unexpected).toEqual([]);
    expect(r.resolved).toEqual([]);
  });
});
