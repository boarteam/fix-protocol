import type { DictionaryJSON, FieldDef, MemberRef, MessageDef } from '@boarteam/fix';
import { describe, expect, it } from 'vitest';
import { diffDictionaries } from './diff';

function field(
  tag: number,
  name: string,
  type = 'String',
  extra: Partial<FieldDef> = {},
): FieldDef {
  return { tag, name, type, ...extra };
}

function dict(over: Partial<DictionaryJSON>): DictionaryJSON {
  return {
    version: 'FIX.4.4',
    beginString: 'FIX.4.4',
    datatypes: { String: { name: 'String', base: 'String' }, int: { name: 'int', base: 'int' } },
    fields: {},
    components: {},
    messages: [],
    ...over,
  };
}

function msg(msgType: string, members: MemberRef[], name = `Msg${msgType}`): MessageDef {
  return { msgType, name, category: 'app', members };
}

const f = (tag: number, reqd: 'Y' | 'N' | 'C' = 'N'): MemberRef => ({ kind: 'field', tag, reqd });

describe('diffDictionaries — fields', () => {
  const base = dict({ fields: { 1: field(1, 'Account'), 2: field(2, 'Count', 'int') } });

  it('finds nothing when dictionaries are equal', () => {
    expect(diffDictionaries(base, base)).toEqual([]);
  });

  it('detects a renamed field with a value-bearing signature', () => {
    const other = dict({ fields: { 1: field(1, 'Acct'), 2: field(2, 'Count', 'int') } });
    expect(diffDictionaries(base, other)).toEqual([
      {
        category: 'field-name',
        key: '1',
        detail: 'md=Account xml=Acct',
        signature: 'field-name|1|Account>Acct',
        tags: [1],
      },
    ]);
  });

  it('detects a field present in only one side', () => {
    const md = dict({ fields: { 1: field(1, 'Account') } });
    const xml = dict({ fields: { 1: field(1, 'Account'), 9: field(9, 'New') } });
    expect(diffDictionaries(md, xml)).toContainEqual(
      expect.objectContaining({ category: 'field-only-in-xml', key: '9' }),
    );
  });

  it('detects a datatype change (normalised) and an enum change', () => {
    const md = dict({
      fields: {
        1: field(1, 'X', 'String', { enumValues: [{ value: 'A', name: 'A', description: 'A' }] }),
      },
    });
    const xml = dict({
      fields: {
        1: field(1, 'X', 'STRING', { enumValues: [{ value: 'B', name: 'B', description: 'B' }] }),
      },
    });
    // STRING ≡ String, so no field-type; the enum set differs.
    expect(diffDictionaries(md, xml).map((d) => d.category)).toEqual(['field-enum']);
  });

  it('honours ignoreFields for both presence and structure', () => {
    const md = dict({ fields: { 1: field(1, 'A') }, messages: [msg('D', [f(1)])] });
    const xml = dict({
      fields: { 1: field(1, 'A'), 9: field(9, 'Dep') },
      messages: [msg('D', [f(1), f(9)])],
    });
    expect(diffDictionaries(md, xml)).toContainEqual(
      expect.objectContaining({ category: 'message-structure', key: 'D', tags: [9] }),
    );
    expect(diffDictionaries(md, xml, { ignoreFields: new Set([9]) })).toEqual([]);
  });
});

describe('diffDictionaries — structure', () => {
  it('compares messages with components fully expanded (factoring is invisible)', () => {
    const md = dict({
      fields: { 1: field(1, 'A'), 2: field(2, 'B') },
      components: { Both: { name: 'Both', members: [f(1), f(2)] } },
      messages: [msg('D', [{ kind: 'component', name: 'Both', reqd: 'N' }])],
    });
    const xml = dict({
      fields: { 1: field(1, 'A'), 2: field(2, 'B') },
      components: {
        One: { name: 'One', members: [f(1)] },
        Two: { name: 'Two', members: [f(2)] },
      },
      messages: [
        msg('D', [
          { kind: 'component', name: 'One', reqd: 'N' },
          { kind: 'component', name: 'Two', reqd: 'N' },
        ]),
      ],
    });
    const diffs = diffDictionaries(md, xml);
    expect(diffs.some((d) => d.category === 'message-structure')).toBe(false);
    expect(diffs.filter((d) => d.category.startsWith('component-only')).length).toBe(3);
  });

  it('neutralises a per-occurrence reconstruction gap (canonical/empty body)', () => {
    const group = (members: MemberRef[], bodyFromCanonical?: boolean): MemberRef => ({
      kind: 'group',
      counterTag: 100,
      reqd: 'N',
      members,
      ...(bodyFromCanonical ? { bodyFromCanonical } : {}),
    });
    const fields = { 100: field(100, 'NoX', 'NumInGroup'), 1: field(1, 'A'), 2: field(2, 'B') };
    // MD side: empty body (unresolved) — XML has a full body. No structural diff.
    const mdEmpty = dict({ fields, messages: [msg('D', [group([])])] });
    const xml = dict({ fields, messages: [msg('D', [group([f(1), f(2)])])] });
    expect(diffDictionaries(mdEmpty, xml).some((d) => d.category === 'message-structure')).toBe(
      false,
    );
    // MD side: bodyFromCanonical — also neutralised even though contents differ.
    const mdCanonical = dict({ fields, messages: [msg('D', [group([f(1)], true)])] });
    expect(diffDictionaries(mdCanonical, xml).some((d) => d.category === 'message-structure')).toBe(
      false,
    );
  });

  it('does NOT neutralise a resolved (non-gap) group — drift inside it is reported', () => {
    const group = (members: MemberRef[]): MemberRef => ({
      kind: 'group',
      counterTag: 100,
      reqd: 'N',
      members,
    });
    const fields = { 100: field(100, 'NoX', 'NumInGroup'), 1: field(1, 'A'), 2: field(2, 'B') };
    // Both sides have a real (non-canonical) body, but they differ — must be caught.
    const md = dict({ fields, messages: [msg('D', [group([f(1)])])] });
    const xml = dict({ fields, messages: [msg('D', [group([f(1), f(2)])])] });
    expect(diffDictionaries(md, xml)).toContainEqual(
      expect.objectContaining({ category: 'message-structure', key: 'D', tags: [2] }),
    );
  });

  it('reports a reqd mismatch when structure is otherwise identical', () => {
    const md = dict({ fields: { 1: field(1, 'A') }, messages: [msg('D', [f(1, 'Y')])] });
    const xml = dict({ fields: { 1: field(1, 'A') }, messages: [msg('D', [f(1, 'N')])] });
    expect(diffDictionaries(md, xml)).toContainEqual(
      expect.objectContaining({
        category: 'message-reqd',
        key: 'D',
        signature: 'message-reqd|D|tag1|md=Yxml=N',
      }),
    );
  });

  it('reports message presence, name, and category differences', () => {
    const md = dict({
      messages: [{ msgType: 'D', name: 'New Order - Single', category: 'app', members: [] }],
    });
    const xml = dict({
      messages: [
        { msgType: 'D', name: 'NewOrderSingle', category: 'admin', members: [] },
        msg('8', [], 'ExecutionReport'),
      ],
    });
    const cats = diffDictionaries(md, xml).map((d) => d.category);
    expect(cats).toContain('message-name');
    expect(cats).toContain('message-category');
    expect(cats).toContain('message-only-in-xml');
  });
});
