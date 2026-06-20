import { describe, expect, it } from 'vitest';
import type { CoverageGap } from '@boarteam/fix';
import { buildMembers, type BuildContext, harvestRegistry } from './structure';
import type { TableRow } from './table';

const fieldRow = (tag: number, depth = 0, reqd: TableRow['reqd'] = 'N'): TableRow => ({
  depth,
  reqd,
  field: { tag, name: `F${tag}` },
});
const compRow = (file: string, depth = 0, reqd: TableRow['reqd'] = 'N'): TableRow => ({
  depth,
  reqd,
  component: { file, linkText: `<${file}>` },
});

function makeCtx(over: Partial<BuildContext> = {}): { ctx: BuildContext; gaps: CoverageGap[] } {
  const gaps: CoverageGap[] = [];
  const ctx: BuildContext = {
    isCounter: (t) => t === 268 || t === 711 || t === 555,
    componentNameByFile: new Map([['Underlying_Instrument', 'Underlying Instrument']]),
    knownComponents: new Set(['Underlying Instrument']),
    registry: new Map(),
    ambiguousCounters: new Set(),
    where: 'test',
    gaps,
    ...over,
  };
  return { ctx, gaps };
}

describe('harvestRegistry', () => {
  it('captures a top-level counter body, stripped one level', () => {
    // 711 at depth 0 followed by its body at depth 1 (a component ref).
    const rows = [fieldRow(711, 0), compRow('Underlying_Instrument', 1, 'C')];
    const { registry, ambiguous } = harvestRegistry([rows], (t) => t === 711);
    expect(registry.get(711)).toEqual([compRow('Underlying_Instrument', 0, 'C')]);
    expect(ambiguous.has(711)).toBe(false); // only one body seen
  });

  it('prefers the smallest body and flags the counter ambiguous when bodies disagree', () => {
    const big = [
      fieldRow(555, 0),
      compRow('Instrument_Leg', 1),
      fieldRow(600, 1),
      fieldRow(601, 1),
    ];
    const small = [fieldRow(555, 0), compRow('Instrument_Leg', 1)];
    const { registry, ambiguous } = harvestRegistry([big, small], (t) => t === 555);
    expect(registry.get(555)).toHaveLength(1);
    expect(ambiguous.has(555)).toBe(true);
  });

  it('breaks ties by first-seen and is not ambiguous when sizes match but content differs', () => {
    const a = [fieldRow(555, 0), fieldRow(600, 1)];
    const b = [fieldRow(555, 0), fieldRow(601, 1)];
    const { registry, ambiguous } = harvestRegistry([a, b], (t) => t === 555);
    expect(registry.get(555)).toEqual([fieldRow(600, 0)]); // first-seen wins the tie
    expect(ambiguous.has(555)).toBe(true); // distinct content => still ambiguous
  });
});

describe('buildMembers', () => {
  it('reconstructs a top-level group from depth transitions', () => {
    const { ctx } = makeCtx();
    const rows = [
      fieldRow(262, 0, 'N'),
      fieldRow(268, 0, 'Y'),
      fieldRow(269, 1, 'Y'),
      fieldRow(270, 1, 'C'),
      fieldRow(813, 0, 'N'),
    ];
    expect(buildMembers(rows, ctx)).toEqual([
      { kind: 'field', tag: 262, reqd: 'N' },
      {
        kind: 'group',
        counterTag: 268,
        reqd: 'Y',
        members: [
          { kind: 'field', tag: 269, reqd: 'Y' },
          { kind: 'field', tag: 270, reqd: 'C' },
        ],
      },
      { kind: 'field', tag: 813, reqd: 'N' }, // group closed when depth returned to 0
    ]);
  });

  it('fills a nested (bodiless) counter from the canonical registry and flags it', () => {
    const registry = new Map<number, TableRow[]>([
      [711, [compRow('Underlying_Instrument', 0, 'C')]],
    ]);
    const { ctx } = makeCtx({ registry });
    // 268 group whose body contains a bare nested 711 counter (no inline body).
    const rows = [
      fieldRow(268, 0, 'Y'),
      fieldRow(279, 1, 'Y'),
      fieldRow(711, 1, 'N'),
      fieldRow(55, 1, 'N'),
    ];
    const [group] = buildMembers(rows, ctx);
    expect(group).toEqual({
      kind: 'group',
      counterTag: 268,
      reqd: 'Y',
      members: [
        { kind: 'field', tag: 279, reqd: 'Y' },
        {
          kind: 'group',
          counterTag: 711,
          reqd: 'N',
          bodyFromCanonical: true,
          members: [{ kind: 'component', name: 'Underlying Instrument', reqd: 'C' }],
        },
        { kind: 'field', tag: 55, reqd: 'N' },
      ],
    });
  });

  it('records an approximate-group gap when backfilling an ambiguous counter', () => {
    const registry = new Map<number, TableRow[]>([
      [711, [compRow('Underlying_Instrument', 0, 'C')]],
    ]);
    const { ctx, gaps } = makeCtx({ registry, ambiguousCounters: new Set([711]) });
    const rows = [fieldRow(268, 0, 'Y'), fieldRow(711, 1, 'N')];
    const [group] = buildMembers(rows, ctx);
    if (group?.kind === 'group') {
      const nested = group.members[0];
      expect(nested).toMatchObject({ kind: 'group', counterTag: 711, bodyFromCanonical: true });
    }
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ kind: 'approximate-group' });
  });

  it('records a coverage gap when a nested counter has no inline or canonical body', () => {
    const { ctx, gaps } = makeCtx();
    const rows = [fieldRow(268, 0, 'Y'), fieldRow(711, 1, 'N')];
    const [group] = buildMembers(rows, ctx);
    expect(group).toMatchObject({ kind: 'group', counterTag: 268 });
    if (group?.kind === 'group') {
      expect(group.members).toEqual([{ kind: 'group', counterTag: 711, reqd: 'N', members: [] }]);
    }
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ kind: 'unresolved-group' });
  });

  it('records a gap for an unknown component reference', () => {
    const { ctx, gaps } = makeCtx();
    buildMembers([compRow('Mystery_Block', 0, 'N')], ctx);
    expect(gaps[0]).toMatchObject({ kind: 'unknown-component' });
  });
});
