import { describe, expect, it } from 'vitest';
import type { DictionaryJSON, FieldDef, MemberRef } from './types';
import { validateDictionary } from './validateDictionary';

/** A minimal, internally-consistent dictionary that validates clean. */
function base(): DictionaryJSON {
  return {
    version: 'FIX.4.4',
    beginString: 'FIX.4.4',
    datatypes: {
      int: { name: 'int', base: 'int' },
      String: { name: 'String', base: 'String' },
      NumInGroup: { name: 'NumInGroup', base: 'int', parent: 'int' },
    },
    fields: {
      8: { tag: 8, name: 'BeginString', type: 'String' },
      35: { tag: 35, name: 'MsgType', type: 'String' },
      10: { tag: 10, name: 'CheckSum', type: 'String' },
      55: { tag: 55, name: 'Symbol', type: 'String' },
      268: { tag: 268, name: 'NoMDEntries', type: 'NumInGroup', isGroupCounter: true },
      269: { tag: 269, name: 'MDEntryType', type: 'String' },
    },
    components: {
      H: {
        name: 'H',
        members: [
          { kind: 'field', tag: 8, reqd: 'Y' },
          { kind: 'field', tag: 35, reqd: 'Y' },
        ],
      },
      T: { name: 'T', members: [{ kind: 'field', tag: 10, reqd: 'Y' }] },
    },
    messages: [
      {
        name: 'M',
        msgType: 'A',
        category: 'admin',
        members: [
          { kind: 'component', name: 'H', reqd: 'Y' },
          {
            kind: 'group',
            counterTag: 268,
            reqd: 'N',
            members: [{ kind: 'field', tag: 269, reqd: 'Y' }],
          },
          { kind: 'component', name: 'T', reqd: 'Y' },
        ],
      },
    ],
  };
}

/** Mutate a fresh base dictionary and return the validation issues. */
function run(mutate: (d: DictionaryJSON) => void): ReturnType<typeof validateDictionary> {
  const d = base();
  mutate(d);
  return validateDictionary(d);
}

function expectCode(
  issues: ReturnType<typeof validateDictionary>,
  code: string,
  severity: 'error' | 'warning',
) {
  const found = issues.find((i) => i.code === code);
  expect(found, `expected issue ${code}`).toBeDefined();
  expect(found!.severity).toBe(severity);
}

describe('validateDictionary', () => {
  it('returns no issues for an internally consistent dictionary', () => {
    expect(validateDictionary(base())).toEqual([]);
  });

  it('never throws on a corrupt object missing whole collections', () => {
    let issues!: ReturnType<typeof validateDictionary>;
    expect(() => {
      issues = validateDictionary({ version: 'x', beginString: 'x' } as unknown as DictionaryJSON);
    }).not.toThrow();
    expectCode(issues, 'dict/missing-datatypes', 'error');
    expectCode(issues, 'dict/missing-fields', 'error');
    expectCode(issues, 'dict/missing-components', 'error');
    expectCode(issues, 'dict/missing-messages', 'error');
  });

  it('never throws on a completely empty object', () => {
    expect(() => validateDictionary({} as unknown as DictionaryJSON)).not.toThrow();
  });

  it('flags missing version and beginString', () => {
    expectCode(
      run((d) => ((d as { version?: string }).version = '')),
      'dict/missing-version',
      'error',
    );
    expectCode(
      run((d) => ((d as { beginString?: string }).beginString = '')),
      'dict/missing-begin-string',
      'error',
    );
  });

  it('flags datatype problems: bad base, cycle, missing parent', () => {
    expectCode(
      run((d) => (d.datatypes['X'] = { name: 'X', base: 'Money' as never, parent: 'String' })),
      'dict/datatype-bad-base',
      'error',
    );
    expectCode(
      run((d) => {
        d.datatypes['A'] = { name: 'A', base: 'int', parent: 'B' };
        d.datatypes['B'] = { name: 'B', base: 'int', parent: 'A' };
      }),
      'dict/datatype-cycle',
      'error',
    );
    expectCode(
      run((d) => (d.datatypes['Z'] = { name: 'Z', base: 'int', parent: 'Nope' })),
      'dict/datatype-missing-parent',
      'error',
    );
  });

  it('flags field problems: bad tag, key mismatch, unknown type, duplicate name, duplicate enum value', () => {
    expectCode(
      run((d) => (d.fields[-1] = { tag: -1, name: 'Neg', type: 'String' })),
      'dict/field-bad-tag',
      'error',
    );
    expectCode(
      run((d) => (d.fields[777] = { tag: 55, name: 'Alias', type: 'String' })),
      'dict/field-key-mismatch',
      'error',
    );
    expectCode(
      run((d) => (d.fields[55]!.type = 'Bogus')),
      'dict/field-unknown-type',
      'error',
    );
    expectCode(
      run((d) => (d.fields[777] = { tag: 777, name: 'Symbol', type: 'String' })),
      'dict/duplicate-field-name',
      'error',
    );
    expectCode(
      run(
        (d) =>
          (d.fields[55]!.enumValues = [
            { value: '1', name: 'A', description: 'a' },
            { value: '1', name: 'B', description: 'b' },
          ]),
      ),
      'dict/duplicate-enum-value',
      'warning',
    );
  });

  it('flags message problems: missing MsgType, duplicate MsgType, duplicate name', () => {
    expectCode(
      run((d) => (d.messages[0]!.msgType = '')),
      'dict/message-missing-msgtype',
      'error',
    );
    expectCode(
      run((d) => d.messages.push({ ...base().messages[0]!, name: 'M2', msgType: 'A' })),
      'dict/duplicate-msgtype',
      'warning',
    );
    expectCode(
      run((d) => d.messages.push({ ...base().messages[0]!, name: 'M', msgType: 'B' })),
      'dict/duplicate-message-name',
      'warning',
    );
  });

  it('flags reference problems: unknown field, unknown component, component cycle', () => {
    expectCode(
      run((d) => d.messages[0]!.members.push({ kind: 'field', tag: 9999, reqd: 'N' })),
      'dict/unknown-field-ref',
      'error',
    );
    expectCode(
      run((d) => d.messages[0]!.members.push({ kind: 'component', name: 'Nope', reqd: 'N' })),
      'dict/unknown-component-ref',
      'error',
    );
    expectCode(
      run((d) => d.components['H']!.members.push({ kind: 'component', name: 'H', reqd: 'N' })),
      'dict/component-cycle',
      'error',
    );
  });

  it('flags group problems: unknown counter, non-counter head, empty group, unresolvable delimiter', () => {
    const group = (over: Partial<Extract<MemberRef, { kind: 'group' }>>): MemberRef => ({
      kind: 'group',
      counterTag: 268,
      reqd: 'N',
      members: [{ kind: 'field', tag: 269, reqd: 'Y' }],
      ...over,
    });
    expectCode(
      run((d) => d.messages[0]!.members.push(group({ counterTag: 9999 }))),
      'dict/unknown-group-counter',
      'error',
    );
    expectCode(
      run((d) => d.messages[0]!.members.push(group({ counterTag: 55 }))),
      'dict/non-counter-group-head',
      'warning',
    );
    expectCode(
      run((d) => d.messages[0]!.members.push(group({ members: [] }))),
      'dict/empty-group',
      'warning',
    );
    expectCode(
      run((d) => {
        d.components['Empty'] = { name: 'Empty', members: [] };
        d.messages[0]!.members.push(
          group({ members: [{ kind: 'component', name: 'Empty', reqd: 'N' }] }),
        );
      }),
      'dict/unresolvable-group-delimiter',
      'error',
    );
  });

  it('exposes issue codes as data without throwing for any single defect', () => {
    // Sanity: a defect produces structured issues, never an exception.
    const issues = run(
      (d) => (d.fields[55] as FieldDef).type === 'String' && (d.fields[55]!.type = 'Bogus'),
    );
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((i) => typeof i.code === 'string' && typeof i.message === 'string')).toBe(
      true,
    );
  });
});
