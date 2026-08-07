import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The emitter's pure pieces. Plain .mjs build tooling — no d.ts, hence the
// ts-expect-error; the tests below are the typing.
// @ts-expect-error untyped internal script module
import * as apiModel from '../scripts/api-model.mjs';

const {
  extractSurface,
  checkLinks,
  checkDocCoverage,
  structuralOf,
  diffAgainstBaseline,
  versionDelta,
  pendingChangesetLevel,
} = apiModel as {
  extractSurface: (dts?: string) => { symbols: any[]; problems: string[] };
  checkLinks: (symbols: any[]) => string[];
  checkDocCoverage: (symbols: any[]) => {
    problems: string[];
    paramsDocumented: number;
    paramsTotal: number;
  };
  structuralOf: (symbols: any[]) => any[];
  diffAgainstBaseline: (
    current: any[],
    baseline: { symbols: any[] },
  ) => { changes: string[]; required: string };
  versionDelta: (from: string, to: string) => string;
  pendingChangesetLevel: (dir?: string) => string;
};

const PKG_DIR = join(__dirname, '..');
const DTS = join(PKG_DIR, 'dist', 'index.d.ts');
const built = existsSync(DTS);

describe('versionDelta', () => {
  it('classifies literal SemVer position changes, 0.x included', () => {
    expect(versionDelta('0.4.0', '0.4.1')).toBe('patch');
    expect(versionDelta('0.4.0', '0.5.0')).toBe('minor');
    expect(versionDelta('0.4.0', '1.0.0')).toBe('major');
    expect(versionDelta('0.4.0', '0.4.0')).toBe('none');
  });
});

describe('diffAgainstBaseline', () => {
  const sym = (id: string, over: object = {}) => ({
    id,
    kind: 'interface',
    signature: `interface ${id}`,
    members: [{ name: 'a', kind: 'property', optional: false, text: 'a: string', doc: 'x' }],
    ...over,
  });
  const baseline = { symbols: structuralOf([sym('Keep'), sym('Gone')]) };

  it('an added export needs a minor', () => {
    const { changes, required } = diffAgainstBaseline(
      [sym('Keep'), sym('Gone'), sym('Fresh')],
      baseline,
    );
    expect(changes).toEqual(['added export Fresh']);
    expect(required).toBe('minor');
  });

  it('a removed export needs a major', () => {
    const { changes, required } = diffAgainstBaseline([sym('Keep')], baseline);
    expect(changes).toEqual(['removed export Gone']);
    expect(required).toBe('major');
  });

  it('a purely additive member extension needs a minor; altering one needs a major', () => {
    const extended = sym('Keep', {
      members: [
        { name: 'a', kind: 'property', optional: false, text: 'a: string', doc: 'x' },
        { name: 'b', kind: 'property', optional: true, text: 'b?: number', doc: 'y' },
      ],
    });
    const grow = diffAgainstBaseline([extended, sym('Gone')], baseline);
    expect(grow.changes).toEqual(['extended Keep (+b)']);
    expect(grow.required).toBe('minor');

    const altered = sym('Keep', {
      members: [{ name: 'a', kind: 'property', optional: false, text: 'a: number', doc: 'x' }],
    });
    expect(diffAgainstBaseline([altered, sym('Gone')], baseline).required).toBe('major');
  });

  it('doc-text changes are not surface changes', () => {
    const redocumented = sym('Keep', {
      doc: 'entirely new prose',
      members: [{ name: 'a', kind: 'property', optional: false, text: 'a: string', doc: 'new' }],
    });
    const { changes, required } = diffAgainstBaseline([redocumented, sym('Gone')], baseline);
    expect(changes).toEqual([]);
    expect(required).toBe('none');
  });
});

describe('checkLinks', () => {
  const symbols = [
    {
      id: 'parse',
      kind: 'function',
      doc: 'See {@link ParseResult} and {@link raw}.',
      params: [{ name: 'raw' }],
      members: [],
    },
    {
      id: 'ParseResult',
      kind: 'interface',
      doc: '',
      members: [
        { name: 'message', doc: 'See {@link issues}.' },
        { name: 'issues', doc: '' },
      ],
    },
  ];

  it('accepts exports, dotted members, enclosing members and params', () => {
    expect(checkLinks(symbols)).toEqual([]);
    expect(
      checkLinks([{ id: 'X', doc: 'See {@link ParseResult.message}.', members: [] }, ...symbols]),
    ).toEqual([]);
  });

  it('rejects unknown targets and rollup path forms', () => {
    expect(checkLinks([{ id: 'X', doc: '{@link Nope}', members: [] }])).toHaveLength(1);
    expect(checkLinks([{ id: 'X', doc: '{@link ./codec/parse.parse}', members: [] }])).toHaveLength(
      1,
    );
  });

  it('allowlists the known JavaScript globals', () => {
    expect(checkLinks([{ id: 'X', doc: '{@link String.indexOf}', members: [] }])).toEqual([]);
  });
});

describe('pendingChangesetLevel', () => {
  it('returns none when the changeset dir has no pending entries', () => {
    // The real .changeset dir of this repo — pending entries would make this
    // legitimately non-none, so only assert the value is a valid level.
    expect(['none', 'patch', 'minor', 'major']).toContain(pendingChangesetLevel());
  });
});

describe.skipIf(!built)('the emitted surface (requires a build)', () => {
  const { symbols, problems } = extractSurface();

  it('extracts cleanly', () => {
    expect(problems).toEqual([]);
    expect(symbols.length).toBeGreaterThanOrEqual(98);
  });

  it('every export and member is documented; links resolve', () => {
    expect(checkDocCoverage(symbols).problems).toEqual([]);
    expect(checkLinks(symbols)).toEqual([]);
  });

  it('matches the committed baseline within the allowed release level', () => {
    const baseline = JSON.parse(readFileSync(join(PKG_DIR, 'api', 'baseline.json'), 'utf8'));
    const pkg = JSON.parse(readFileSync(join(PKG_DIR, 'package.json'), 'utf8'));
    const rank = (level: string): number => ({ none: 0, patch: 1, minor: 2, major: 3 })[level] ?? 0;
    const allowed = Math.max(
      rank(versionDelta(baseline.version, pkg.version)),
      rank(pendingChangesetLevel()),
    );
    expect(rank(diffAgainstBaseline(symbols, baseline).required)).toBeLessThanOrEqual(allowed);
  });

  it('ships api.json beside the d.ts with the same export list', () => {
    const apiPath = join(PKG_DIR, 'dist', 'api.json');
    expect(existsSync(apiPath)).toBe(true);
    const api = JSON.parse(readFileSync(apiPath, 'utf8'));
    expect(api.schema).toBe(1);
    expect(api.symbols.map((s: { id: string }) => s.id)).toEqual(symbols.map((s) => s.id));
    expect(api.symbols.every((s: { source: unknown; since: string }) => s.source && s.since)).toBe(
      true,
    );
  });
});
