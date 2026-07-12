import { describe, expect, it } from 'vitest';
import type { FixIssue } from '../errors';
import { extendDictionary } from './extendDictionary';
import type { DictionaryExtension } from './extension';
import type { DictionaryJSON, GroupMember } from './types';
import { validateDictionary } from './validateDictionary';

/**
 * A minimal, internally consistent dictionary shaped like the structures that matter for
 * extension semantics: a header/trailer pair, a shared component (`Instrument`, referenced
 * twice), a single-reference component holding a repeating group (`SecListGrp`, the
 * cTrader shape), and a nested group inside that group.
 */
function base(): DictionaryJSON {
  return {
    version: 'FIX.4.4',
    beginString: 'FIX.4.4',
    datatypes: {
      int: { name: 'int', base: 'int' },
      String: { name: 'String', base: 'String' },
      data: { name: 'data', base: 'data' },
      NumInGroup: { name: 'NumInGroup', base: 'int', parent: 'int' },
    },
    fields: {
      8: { tag: 8, name: 'BeginString', type: 'String' },
      35: { tag: 35, name: 'MsgType', type: 'String' },
      34: { tag: 34, name: 'MsgSeqNum', type: 'int' },
      49: { tag: 49, name: 'SenderCompID', type: 'String' },
      10: { tag: 10, name: 'CheckSum', type: 'String' },
      55: { tag: 55, name: 'Symbol', type: 'String' },
      48: { tag: 48, name: 'SecurityID', type: 'String' },
      58: { tag: 58, name: 'Text', type: 'String' },
      320: { tag: 320, name: 'SecurityReqID', type: 'String' },
      311: { tag: 311, name: 'UnderlyingSymbol', type: 'String' },
      146: { tag: 146, name: 'NoRelatedSym', type: 'NumInGroup', isGroupCounter: true },
      711: { tag: 711, name: 'NoUnderlyings', type: 'NumInGroup', isGroupCounter: true },
    },
    components: {
      Header: {
        name: 'Header',
        members: [
          { kind: 'field', tag: 8, reqd: 'Y' },
          { kind: 'field', tag: 35, reqd: 'Y' },
          { kind: 'field', tag: 49, reqd: 'Y' },
          { kind: 'field', tag: 34, reqd: 'Y' },
        ],
      },
      Trailer: { name: 'Trailer', members: [{ kind: 'field', tag: 10, reqd: 'Y' }] },
      Instrument: {
        name: 'Instrument',
        members: [
          { kind: 'field', tag: 55, reqd: 'Y' },
          { kind: 'field', tag: 48, reqd: 'N' },
        ],
      },
      SecListGrp: {
        name: 'SecListGrp',
        members: [
          {
            kind: 'group',
            counterTag: 146,
            reqd: 'N',
            members: [
              { kind: 'component', name: 'Instrument', reqd: 'Y' },
              {
                kind: 'group',
                counterTag: 711,
                reqd: 'N',
                members: [{ kind: 'field', tag: 311, reqd: 'Y' }],
              },
            ],
          },
        ],
      },
    },
    messages: [
      {
        name: 'SecurityList',
        msgType: 'y',
        category: 'app',
        members: [
          { kind: 'component', name: 'Header', reqd: 'Y' },
          { kind: 'field', tag: 320, reqd: 'N' },
          { kind: 'component', name: 'SecListGrp', reqd: 'Y' },
          { kind: 'component', name: 'Trailer', reqd: 'Y' },
        ],
      },
      {
        name: 'Quote',
        msgType: 'S',
        category: 'app',
        members: [
          { kind: 'component', name: 'Header', reqd: 'Y' },
          { kind: 'component', name: 'Instrument', reqd: 'Y' },
          { kind: 'field', tag: 58, reqd: 'N' },
          { kind: 'component', name: 'Trailer', reqd: 'Y' },
        ],
      },
    ],
  };
}

function codes(issues: FixIssue[]): string[] {
  return issues.map((i) => i.code);
}

function byCode(issues: FixIssue[], code: string): FixIssue | undefined {
  return issues.find((i) => i.code === code);
}

function errors(issues: FixIssue[]): FixIssue[] {
  return issues.filter((i) => i.severity === 'error');
}

/** The group inside SecListGrp (owned by the component definition). */
function secListGroup(d: DictionaryJSON): GroupMember {
  return d.components['SecListGrp']!.members[0] as GroupMember;
}

describe('extendDictionary', () => {
  it('starts from a gate-clean fixture', () => {
    expect(validateDictionary(base())).toEqual([]);
  });

  describe('fields', () => {
    it('adds new fields, inferring isGroupCounter from the datatype', () => {
      const { dictionary, issues } = extendDictionary(base(), {
        fields: {
          SymbolName: { tag: 5001, type: 'String', description: 'venue name' },
          NoVenueThings: { tag: 5002, type: 'NumInGroup' },
        },
      });
      expect(errors(issues)).toEqual([]);
      expect(dictionary.fields[5001]).toEqual({
        tag: 5001,
        name: 'SymbolName',
        type: 'String',
        description: 'venue name',
      });
      expect(dictionary.fields[5002]!.isGroupCounter).toBe(true);
    });

    it('skips a field whose tag is not a positive integer', () => {
      const { dictionary, issues } = extendDictionary(base(), {
        fields: { Bad: { tag: 0, type: 'String' }, AlsoBad: { tag: 1.5, type: 'String' } },
      });
      expect(codes(issues)).toEqual(['extend/field-bad-tag', 'extend/field-bad-tag']);
      expect(dictionary.fields[0]).toBeUndefined();
    });

    it('skips a field with an unknown datatype', () => {
      const { dictionary, issues } = extendDictionary(base(), {
        fields: { SymbolName: { tag: 5001, type: 'Price' } },
      });
      expect(byCode(issues, 'extend/field-unknown-type')!.severity).toBe('error');
      expect(dictionary.fields[5001]).toBeUndefined();
    });

    it('skips a field whose name is bound to a different tag', () => {
      const { dictionary, issues } = extendDictionary(base(), {
        fields: { Symbol: { tag: 9001, type: 'String' } },
      });
      expect(byCode(issues, 'extend/field-name-collision')!.severity).toBe('error');
      expect(dictionary.fields[9001]).toBeUndefined();
      expect(dictionary.fields[55]!.name).toBe('Symbol');
      // The skip keeps the merged dictionary gate-clean:
      expect(validateDictionary(dictionary)).toEqual([]);
    });

    it('replaces an existing tag with a warning (extension wins)', () => {
      const { dictionary, issues } = extendDictionary(base(), {
        fields: { ReasonText: { tag: 58, type: 'String' } },
      });
      expect(byCode(issues, 'extend/field-tag-collision')!.severity).toBe('warning');
      expect(dictionary.fields[58]!.name).toBe('ReasonText');
      expect(validateDictionary(dictionary)).toEqual([]);
    });

    it('is silent on a byte-identical redefinition (idempotency)', () => {
      const { issues } = extendDictionary(base(), {
        fields: { Symbol: { tag: 55, type: 'String' } },
      });
      expect(issues).toEqual([]);
    });

    it('notes tags outside the user-defined ranges, and only those', () => {
      const { issues } = extendDictionary(base(), {
        fields: {
          SymbolName: { tag: 1007, type: 'String' },
          VenueA: { tag: 5001, type: 'String' },
          VenueB: { tag: 20001, type: 'String' },
        },
      });
      const range = issues.filter((i) => i.code === 'extend/tag-outside-user-range');
      expect(range).toHaveLength(1);
      expect(range[0]!.severity).toBe('info');
      expect(range[0]!.refTagID).toBe(1007);
    });

    it('warns on a data field without a companion length field', () => {
      const { issues } = extendDictionary(base(), {
        fields: {
          VenueBlobLen: { tag: 5001, type: 'int' },
          VenueBlob: { tag: 5002, type: 'data' },
          WiredBlob: { tag: 5003, type: 'data', lengthField: 5001 },
        },
      });
      const unwired = issues.filter((i) => i.code === 'extend/data-length-unwired');
      expect(unwired).toHaveLength(1);
      expect(unwired[0]!.refTagID).toBe(5002);
    });
  });

  describe('enums', () => {
    it('appends enum values to an existing field, defaulting description to name', () => {
      const { dictionary, issues } = extendDictionary(base(), {
        enums: { Text: [{ value: '1', name: 'One' }] },
      });
      expect(errors(issues)).toEqual([]);
      expect(dictionary.fields[58]!.enumValues).toEqual([
        { value: '1', name: 'One', description: 'One' },
      ]);
    });

    it('dedupes identical value+name pairs silently and replaces on name conflict', () => {
      const once = extendDictionary(base(), { enums: { Text: [{ value: '1', name: 'One' }] } });
      const again = extendDictionary(once.dictionary, {
        enums: { Text: [{ value: '1', name: 'One' }] },
      });
      expect(again.issues).toEqual([]);
      expect(again.dictionary.fields[58]!.enumValues).toHaveLength(1);

      const conflicted = extendDictionary(once.dictionary, {
        enums: { Text: [{ value: '1', name: 'Uno' }] },
      });
      expect(byCode(conflicted.issues, 'extend/enum-value-conflict')!.severity).toBe('warning');
      expect(conflicted.dictionary.fields[58]!.enumValues).toEqual([
        { value: '1', name: 'Uno', description: 'Uno' },
      ]);
    });

    it('skips enum entries naming an unknown field', () => {
      const { issues } = extendDictionary(base(), {
        enums: { Nope: [{ value: '1', name: 'One' }] },
      });
      expect(byCode(issues, 'extend/enum-unknown-field')!.severity).toBe('error');
    });
  });

  describe('components', () => {
    it('defines a new component with resolved members', () => {
      const { dictionary, issues } = extendDictionary(base(), {
        fields: { SymbolName: { tag: 5001, type: 'String' } },
        components: { Venue: { members: ['SymbolName', { field: 'Text', reqd: 'Y' }] } },
      });
      expect(errors(issues)).toEqual([]);
      expect(dictionary.components['Venue']).toEqual({
        name: 'Venue',
        members: [
          { kind: 'field', tag: 5001, reqd: 'N' },
          { kind: 'field', tag: 58, reqd: 'Y' },
        ],
      });
      expect(validateDictionary(dictionary)).toEqual([]);
    });

    it('skips a new component whose name already exists', () => {
      const { dictionary, issues } = extendDictionary(base(), {
        components: { Instrument: { members: ['Text'] } },
      });
      expect(byCode(issues, 'extend/component-collision')!.severity).toBe('error');
      expect(dictionary.components['Instrument']!.members).toHaveLength(2);
    });

    it('skips a whole new component when any member is unresolvable (atomic)', () => {
      const { dictionary, issues } = extendDictionary(base(), {
        components: { Venue: { members: ['Text', 'NoSuchField'] } },
      });
      expect(byCode(issues, 'extend/unknown-member')!.severity).toBe('error');
      expect(dictionary.components['Venue']).toBeUndefined();
    });

    it('appends to an existing component and reports the fan-out', () => {
      const { dictionary, issues } = extendDictionary(base(), {
        fields: { SymbolName: { tag: 5001, type: 'String' } },
        components: { Instrument: { append: ['SymbolName'] } },
      });
      expect(errors(issues)).toEqual([]);
      const fanout = byCode(issues, 'extend/component-fanout')!;
      expect(fanout.severity).toBe('info');
      expect(fanout.message).toContain('SecurityList');
      expect(fanout.message).toContain('Quote');
      const members = dictionary.components['Instrument']!.members;
      expect(members[members.length - 1]).toEqual({ kind: 'field', tag: 5001, reqd: 'N' });
    });

    it('reports an unknown component patch target', () => {
      const { issues } = extendDictionary(base(), { components: { Nope: { append: ['Text'] } } });
      expect(byCode(issues, 'extend/target-not-found')!.severity).toBe('error');
    });
  });

  describe('new messages', () => {
    it('wraps a new message with the detected header/trailer and appends it', () => {
      const { dictionary, issues } = extendDictionary(base(), {
        messages: { VenuePing: { msgType: 'U1', members: ['Text'] } },
      });
      expect(errors(issues)).toEqual([]);
      expect(byCode(issues, 'extend/header-trailer-injected')!.severity).toBe('info');
      const message = dictionary.messages.find((m) => m.msgType === 'U1')!;
      expect(message).toMatchObject({ name: 'VenuePing', category: 'app' });
      expect(message.members).toEqual([
        { kind: 'component', name: 'Header', reqd: 'Y' },
        { kind: 'field', tag: 58, reqd: 'N' },
        { kind: 'component', name: 'Trailer', reqd: 'Y' },
      ]);
      expect(validateDictionary(dictionary)).toEqual([]);
    });

    it('does not double-inject when the body already lists the header', () => {
      const { dictionary, issues } = extendDictionary(base(), {
        messages: {
          VenuePing: { msgType: 'U1', members: [{ component: 'Header', reqd: 'Y' }, 'Text'] },
        },
      });
      const message = dictionary.messages.find((m) => m.msgType === 'U1')!;
      expect(
        message.members.filter((m) => m.kind === 'component' && m.name === 'Header'),
      ).toHaveLength(1);
      expect(byCode(issues, 'extend/header-trailer-injected')!.message).toContain('Trailer');
      expect(byCode(issues, 'extend/header-trailer-injected')!.message).not.toContain('"Header"');
    });

    it('warns and applies bare when no header/trailer is detectable', () => {
      const bare = base();
      for (const message of bare.messages) {
        message.members = message.members.filter(
          (m) => !(m.kind === 'component' && (m.name === 'Header' || m.name === 'Trailer')),
        );
      }
      const { dictionary, issues } = extendDictionary(bare, {
        messages: { VenuePing: { msgType: 'U1', members: ['Text'] } },
      });
      expect(byCode(issues, 'extend/header-trailer-missing')!.severity).toBe('warning');
      const message = dictionary.messages.find((m) => m.msgType === 'U1')!;
      expect(message.members).toEqual([{ kind: 'field', tag: 58, reqd: 'N' }]);
    });

    it('replaces an existing message with the same MsgType in place', () => {
      const { dictionary, issues } = extendDictionary(base(), {
        messages: { VenueQuote: { msgType: 'S', members: ['Text'] } },
      });
      expect(byCode(issues, 'extend/msgtype-collision')!.severity).toBe('warning');
      expect(dictionary.messages).toHaveLength(2);
      expect(dictionary.messages[1]!.name).toBe('VenueQuote'); // index of Quote preserved
      expect(validateDictionary(dictionary)).toEqual([]);
    });

    it('warns when a new message duplicates another message name', () => {
      const { dictionary, issues } = extendDictionary(base(), {
        messages: { Quote: { msgType: 'U7', members: ['Text'] } },
      });
      expect(byCode(issues, 'extend/message-name-collision')!.severity).toBe('warning');
      expect(dictionary.messages).toHaveLength(3);
    });
  });

  describe('message patches', () => {
    it('appends before the trailing trailer by default', () => {
      const { dictionary, issues } = extendDictionary(base(), {
        fields: { SymbolName: { tag: 5001, type: 'String' } },
        messages: { Quote: { append: ['SymbolName'] } },
      });
      expect(errors(issues)).toEqual([]);
      const members = dictionary.messages[1]!.members;
      expect(members[members.length - 1]).toEqual({
        kind: 'component',
        name: 'Trailer',
        reqd: 'Y',
      });
      expect(members[members.length - 2]).toEqual({ kind: 'field', tag: 5001, reqd: 'N' });
    });

    it('inserts right after an anchor member with after', () => {
      const { dictionary, issues } = extendDictionary(base(), {
        fields: { SymbolName: { tag: 5001, type: 'String' } },
        messages: { Quote: { append: ['SymbolName'], after: 'Instrument' } },
      });
      expect(errors(issues)).toEqual([]);
      const members = dictionary.messages[1]!.members;
      expect(members[1]).toEqual({ kind: 'component', name: 'Instrument', reqd: 'Y' });
      expect(members[2]).toEqual({ kind: 'field', tag: 5001, reqd: 'N' });
    });

    it('skips the placement when the after anchor is missing', () => {
      const before = base().messages[1]!.members.length;
      const { dictionary, issues } = extendDictionary(base(), {
        fields: { SymbolName: { tag: 5001, type: 'String' } },
        messages: { Quote: { append: ['SymbolName'], after: 'Nope' } },
      });
      expect(byCode(issues, 'extend/member-not-found')!.severity).toBe('error');
      expect(dictionary.messages[1]!.members).toHaveLength(before);
    });

    it('skips the whole placement when any member is unresolvable (atomic)', () => {
      const before = base().messages[1]!.members.length;
      const { dictionary, issues } = extendDictionary(base(), {
        fields: { SymbolName: { tag: 5001, type: 'String' } },
        messages: { Quote: { append: ['SymbolName', 'NoSuchField'] } },
      });
      expect(byCode(issues, 'extend/unknown-member')!.severity).toBe('error');
      expect(dictionary.messages[1]!.members).toHaveLength(before);
    });

    it('skips members already reachable in the scope (duplicate guard, incl. via components)', () => {
      const { dictionary, issues } = extendDictionary(base(), {
        messages: { Quote: { append: ['SecurityID', 'Text'] } },
      });
      const duplicates = issues.filter((i) => i.code === 'extend/duplicate-member');
      expect(duplicates).toHaveLength(2); // 48 reachable via Instrument, 58 is direct
      expect(duplicates.every((i) => i.severity === 'warning')).toBe(true);
      expect(dictionary.messages[1]!.members).toHaveLength(base().messages[1]!.members.length);
    });

    it('reports unknown and ambiguous message targets', () => {
      expect(
        byCode(
          extendDictionary(base(), { messages: { Nope: { append: ['Text'] } } }).issues,
          'extend/target-not-found',
        ),
      ).toBeDefined();

      const dup = base();
      dup.messages.push({ ...dup.messages[1]!, msgType: 'S2' });
      const { issues } = extendDictionary(dup, { messages: { Quote: { append: ['Text'] } } });
      expect(byCode(issues, 'extend/target-not-found')!.message).toContain('ambiguous');
    });
  });

  describe('group placements', () => {
    const ctrader: DictionaryExtension = {
      id: 'ctrader',
      fields: {
        SymbolName: { tag: 1007, type: 'String' },
        SymbolDigits: { tag: 1008, type: 'int' },
      },
      messages: {
        SecurityList: { groups: { NoRelatedSym: { append: ['SymbolName', 'SymbolDigits'] } } },
      },
    };

    it('auto-descends into a group behind a single-reference component (the cTrader case)', () => {
      const { dictionary, issues } = extendDictionary(base(), ctrader);
      expect(errors(issues)).toEqual([]);
      const fanout = byCode(issues, 'extend/component-fanout')!;
      expect(fanout.severity).toBe('info');
      expect(fanout.message).toContain('SecListGrp');
      const group = secListGroup(dictionary);
      expect(group.members.slice(-2)).toEqual([
        { kind: 'field', tag: 1007, reqd: 'N' },
        { kind: 'field', tag: 1008, reqd: 'N' },
      ]);
      expect(validateDictionary(dictionary)).toEqual([]);
      expect(dictionary.extensions).toEqual(['ctrader']);
    });

    it('resolves dotted paths into nested groups', () => {
      const { dictionary, issues } = extendDictionary(base(), {
        fields: { SymbolName: { tag: 5001, type: 'String' } },
        messages: {
          SecurityList: { groups: { 'NoRelatedSym.NoUnderlyings': { append: ['SymbolName'] } } },
        },
      });
      expect(errors(issues)).toEqual([]);
      const nested = secListGroup(dictionary).members[1] as GroupMember;
      expect(nested.counterTag).toBe(711);
      expect(nested.members[nested.members.length - 1]).toEqual({
        kind: 'field',
        tag: 5001,
        reqd: 'N',
      });
    });

    it('refuses to descend through a shared component, with an explicit hint', () => {
      const shared = base();
      // Move the underlyings group inside Instrument (referenced by 2 scopes):
      shared.components['Instrument']!.members.push({
        kind: 'group',
        counterTag: 711,
        reqd: 'N',
        members: [{ kind: 'field', tag: 311, reqd: 'Y' }],
      });
      const { issues } = extendDictionary(shared, {
        fields: { SymbolName: { tag: 5001, type: 'String' } },
        messages: { Quote: { groups: { NoUnderlyings: { append: ['SymbolName'] } } } },
      });
      const notFound = byCode(issues, 'extend/target-not-found')!;
      expect(notFound.severity).toBe('error');
      expect(notFound.message).toContain('Instrument');
      expect(notFound.message).toContain('components');
    });

    it('reports a group path that resolves nowhere', () => {
      const { issues } = extendDictionary(base(), {
        messages: { Quote: { groups: { NoRelatedSym: { append: ['Text'] } } } },
      });
      expect(byCode(issues, 'extend/target-not-found')).toBeDefined();
    });
  });

  describe('placement safety', () => {
    it('rejects a field that would sit ambiguously after an open nested group', () => {
      // 311 belongs to the nested NoUnderlyings scope; appended to the end of the outer
      // NoRelatedSym entry it would re-parse INTO the nested group.
      const { dictionary, issues } = extendDictionary(base(), {
        messages: {
          SecurityList: { groups: { NoRelatedSym: { append: ['UnderlyingSymbol'] } } },
        },
      });
      const boundary = byCode(issues, 'extend/ambiguous-boundary')!;
      expect(boundary.severity).toBe('error');
      expect(boundary.refTagID).toBe(311);
      expect(secListGroup(dictionary).members).toHaveLength(2); // nothing added
    });

    it('allows the same field when anchored ahead of the nested group', () => {
      const { dictionary, issues } = extendDictionary(base(), {
        messages: {
          SecurityList: {
            groups: { NoRelatedSym: { append: ['UnderlyingSymbol'], after: 'Instrument' } },
          },
        },
      });
      expect(errors(issues)).toEqual([]);
      const group = secListGroup(dictionary);
      expect(group.members[1]).toEqual({ kind: 'field', tag: 311, reqd: 'N' });
      expect((group.members[2] as GroupMember).counterTag).toBe(711);
    });

    it('reverts a placement that would shift a group delimiter', () => {
      const tricky = base();
      tricky.fields[999] = { tag: 999, name: 'NoThings', type: 'NumInGroup', isGroupCounter: true };
      tricky.components['EmptyLead'] = { name: 'EmptyLead', members: [] };
      tricky.messages[1]!.members.splice(2, 0, {
        kind: 'group',
        counterTag: 999,
        reqd: 'N',
        // Delimiter resolves THROUGH the field-less leading component to Text (58):
        members: [
          { kind: 'component', name: 'EmptyLead', reqd: 'N' },
          { kind: 'field', tag: 58, reqd: 'Y' },
        ],
      });
      const { dictionary, issues } = extendDictionary(tricky, {
        fields: { SymbolName: { tag: 5001, type: 'String' } },
        components: { EmptyLead: { append: ['SymbolName'] } },
      });
      const shift = byCode(issues, 'extend/group-delimiter-shift')!;
      expect(shift.severity).toBe('error');
      expect(shift.message).toContain('NoThings');
      expect(dictionary.components['EmptyLead']!.members).toEqual([]); // reverted
    });

    it('reports when a delimiter-less group body gains its first wire tag', () => {
      const tricky = base();
      tricky.fields[999] = { tag: 999, name: 'NoThings', type: 'NumInGroup', isGroupCounter: true };
      tricky.components['EmptyLead'] = { name: 'EmptyLead', members: [] };
      tricky.messages[1]!.members.splice(2, 0, {
        kind: 'group',
        counterTag: 999,
        reqd: 'N',
        members: [{ kind: 'component', name: 'EmptyLead', reqd: 'N' }],
      });
      const { dictionary, issues } = extendDictionary(tricky, {
        fields: { SymbolName: { tag: 5001, type: 'String' } },
        components: { EmptyLead: { append: ['SymbolName'] } },
      });
      expect(byCode(issues, 'extend/delimiter-defined')!.severity).toBe('info');
      expect(dictionary.components['EmptyLead']!.members).toEqual([
        { kind: 'field', tag: 5001, reqd: 'N' },
      ]);
    });

    it('places a new nested repeating group and warns on a non-counter head', () => {
      const { dictionary, issues } = extendDictionary(base(), {
        fields: {
          NoVenueAttrs: { tag: 5001, type: 'NumInGroup' },
          VenueAttr: { tag: 5002, type: 'String' },
          FakeCounter: { tag: 5003, type: 'int' },
        },
        messages: {
          Quote: {
            append: [
              { group: 'NoVenueAttrs', members: ['VenueAttr'] },
              { group: 'FakeCounter', members: ['VenueAttr'] },
            ],
          },
        },
      });
      expect(byCode(issues, 'extend/counter-not-marked')!.severity).toBe('warning');
      const members = dictionary.messages[1]!.members;
      const groups = members.filter((m): m is GroupMember => m.kind === 'group');
      expect(groups.map((g) => g.counterTag)).toEqual([5001, 5003]);
      expect(groups[0]!.members).toEqual([{ kind: 'field', tag: 5002, reqd: 'N' }]);
    });
  });

  describe('invariants', () => {
    const ctrader: DictionaryExtension = {
      id: 'ctrader',
      fields: {
        SymbolName: { tag: 1007, type: 'String' },
        SymbolDigits: { tag: 1008, type: 'int' },
      },
      messages: {
        SecurityList: { groups: { NoRelatedSym: { append: ['SymbolName', 'SymbolDigits'] } } },
      },
    };

    it('never mutates the base or the extension', () => {
      const original = base();
      const snapshot = structuredClone(original);
      const extSnapshot = structuredClone(ctrader);
      extendDictionary(original, ctrader);
      expect(original).toEqual(snapshot);
      expect(ctrader).toEqual(extSnapshot);
    });

    it('is idempotent: re-applying an extension changes nothing, including provenance', () => {
      const once = extendDictionary(base(), ctrader);
      const twice = extendDictionary(once.dictionary, ctrader);
      expect(twice.dictionary).toEqual(once.dictionary);
      expect(twice.dictionary.extensions).toEqual(['ctrader']);
      expect(codes(twice.issues)).toContain('extend/duplicate-member');
      expect(errors(twice.issues)).toEqual([]);
    });

    it('composes left to right: later extensions see earlier ones', () => {
      const { dictionary, issues } = extendDictionary(
        base(),
        { id: 'one', fields: { SymbolName: { tag: 1007, type: 'String' } } },
        { id: 'two', messages: { Quote: { append: ['SymbolName'] } } },
      );
      expect(errors(issues)).toEqual([]);
      const members = dictionary.messages[1]!.members;
      expect(members[members.length - 2]).toEqual({ kind: 'field', tag: 1007, reqd: 'N' });
      expect(dictionary.extensions).toEqual(['one', 'two']);
    });

    it('preserves gate-cleanliness when no error-severity issues were reported', () => {
      const { dictionary, issues } = extendDictionary(base(), ctrader, {
        fields: { VenueFlag: { tag: 5005, type: 'String' } },
        enums: { VenueFlag: [{ value: 'A', name: 'Alpha' }] },
        components: { VenueBlock: { members: ['VenueFlag'] } },
        messages: {
          VenuePing: { msgType: 'U1', members: [{ component: 'VenueBlock', reqd: 'Y' }] },
        },
      });
      expect(errors(issues)).toEqual([]);
      expect(validateDictionary(dictionary)).toEqual([]);
    });

    it('never throws on empty or degenerate extensions', () => {
      expect(() => extendDictionary(base())).not.toThrow();
      expect(() => extendDictionary(base(), {})).not.toThrow();
      expect(() => extendDictionary(base(), null as unknown as DictionaryExtension)).not.toThrow();
      expect(() =>
        extendDictionary(base(), { fields: undefined, messages: undefined }),
      ).not.toThrow();
    });

    it('reports malformed entries as extend/invalid-spec instead of throwing', () => {
      const degenerate = {
        fields: { Broken: null },
        enums: { Text: 'nope' },
        components: { C: 42 },
        messages: { M: null, N: { msgType: 'U9' } }, // N: msgType without a members array
      } as unknown as DictionaryExtension;
      let issues!: FixIssue[];
      expect(() => {
        issues = extendDictionary(base(), degenerate).issues;
      }).not.toThrow();
      const invalid = issues.filter((i) => i.code === 'extend/invalid-spec');
      expect(invalid.length).toBeGreaterThanOrEqual(5);
      expect(invalid.every((i) => i.severity === 'error')).toBe(true);
    });
  });

  describe('component cycles', () => {
    it('deletes new components that form a reference cycle (self and mutual)', () => {
      const { dictionary, issues } = extendDictionary(base(), {
        components: {
          Loop: { members: [{ component: 'Loop' }] },
          A: { members: [{ component: 'B' }] },
          B: { members: [{ component: 'A' }] },
        },
      });
      const cycles = issues.filter((i) => i.code === 'extend/component-cycle');
      expect(cycles.length).toBeGreaterThanOrEqual(2); // Loop + at least one of A/B
      expect(dictionary.components['Loop']).toBeUndefined();
      expect(dictionary.components['A']).toBeUndefined();
      expect(dictionary.components['B']).toBeUndefined();
      expect(validateDictionary(dictionary)).toEqual([]);
    });

    it('reverts a placed component reference that would close a cycle', () => {
      const { dictionary, issues } = extendDictionary(base(), {
        components: {
          VenueBlock: { members: [{ component: 'Instrument' }] },
          Instrument: { append: [{ component: 'VenueBlock' }] },
        },
      });
      expect(byCode(issues, 'extend/component-cycle')!.severity).toBe('error');
      expect(dictionary.components['Instrument']!.members).toHaveLength(2); // untouched
      expect(dictionary.components['VenueBlock']).toBeDefined(); // itself fine
      expect(validateDictionary(dictionary)).toEqual([]);
    });

    it('deletes new components left dangling by a skipped sibling (fixpoint)', () => {
      const { dictionary, issues } = extendDictionary(base(), {
        components: {
          // Declared BEFORE the broken one so its reference resolves in pass 2:
          Dependent: { members: ['Text', { component: 'Bad' }] },
          Bad: { members: ['NoSuchField'] },
        },
      });
      expect(codes(issues)).toContain('extend/unknown-member');
      expect(dictionary.components['Bad']).toBeUndefined();
      expect(dictionary.components['Dependent']).toBeUndefined();
      expect(validateDictionary(dictionary)).toEqual([]);
    });
  });

  describe('review-hardened placement safety', () => {
    it('skips a new group whose body resolves to no entry delimiter', () => {
      const { dictionary, issues } = extendDictionary(base(), {
        components: { EmptyComp: { members: [] } },
        messages: {
          Quote: {
            append: [
              { group: 'NoUnderlyings', members: [{ component: 'EmptyComp' }] },
              { group: 'NoRelatedSym', members: [] },
            ],
          },
        },
      });
      const skipped = issues.filter((i) => i.code === 'extend/unresolvable-group-delimiter');
      expect(skipped).toHaveLength(2);
      expect(skipped.every((i) => i.severity === 'error')).toBe(true);
      expect(dictionary.messages[1]!.members).toHaveLength(base().messages[1]!.members.length);
      expect(validateDictionary(dictionary)).toEqual([]);
    });

    it('rejects a component-targeted append that lands after an open group in a referencing scope', () => {
      const shared = base();
      shared.components['Extras'] = { name: 'Extras', members: [] };
      // Extras sits right AFTER the group-bearing component in SecurityList:
      shared.messages[0]!.members.splice(3, 0, { kind: 'component', name: 'Extras', reqd: 'N' });
      // Appending Symbol (55, in NoRelatedSym's scope) to Extras would put it on the wire
      // straight after the group's entries in SecurityList:
      const { dictionary, issues } = extendDictionary(shared, {
        components: { Extras: { append: ['Symbol'] } },
      });
      expect(byCode(issues, 'extend/ambiguous-boundary')!.severity).toBe('error');
      expect(dictionary.components['Extras']!.members).toEqual([]);
    });

    it('skips a component-targeted append duplicating a field of a referencing scope', () => {
      const shared = base();
      shared.components['Extras'] = { name: 'Extras', members: [] };
      shared.messages[1]!.members.splice(2, 0, { kind: 'component', name: 'Extras', reqd: 'N' });
      // Quote carries Text (58) directly; adding it to Extras would double-emit it there.
      const { dictionary, issues } = extendDictionary(shared, {
        components: { Extras: { append: ['Text'] } },
      });
      expect(byCode(issues, 'extend/duplicate-member')!.severity).toBe('warning');
      expect(dictionary.components['Extras']!.members).toEqual([]);
    });

    it('looks through optional members when finding the open group (backward)', () => {
      // SecurityList body: [Header, 320(N), SecListGrp, Trailer] — 320 is optional, the
      // group inside SecListGrp is the latest guaranteed wire content before the trailer.
      const { dictionary, issues } = extendDictionary(base(), {
        messages: { SecurityList: { append: ['Symbol'] } }, // 55 ∈ the group's scope
      });
      expect(byCode(issues, 'extend/ambiguous-boundary')!.severity).toBe('error');
      expect(dictionary.messages[0]!.members).toHaveLength(base().messages[0]!.members.length);

      // A REQUIRED field between the group and the insertion point seals the context:
      const sealed = base();
      sealed.messages[0]!.members.splice(3, 0, { kind: 'field', tag: 58, reqd: 'Y' });
      const ok = extendDictionary(sealed, {
        messages: { SecurityList: { append: ['Symbol'] } },
      });
      expect(errors(ok.issues)).toEqual([]);
      const members = ok.dictionary.messages[0]!.members;
      expect(members[members.length - 2]).toEqual({ kind: 'field', tag: 55, reqd: 'N' });
    });

    it('rejects a placed group that would capture wire members following it (forward)', () => {
      // Insert a group containing Text (58) right after Instrument in Quote — the
      // pre-existing optional 58 that follows would re-parse INTO the new group.
      const { dictionary, issues } = extendDictionary(base(), {
        fields: {
          NoVenueAttrs: { tag: 5001, type: 'NumInGroup' },
          VenueAttr: { tag: 5002, type: 'String' },
        },
        messages: {
          Quote: {
            append: [{ group: 'NoVenueAttrs', members: ['VenueAttr', 'Text'] }],
            after: 'Instrument',
          },
        },
      });
      expect(byCode(issues, 'extend/ambiguous-boundary')!.severity).toBe('error');
      expect(dictionary.messages[1]!.members).toHaveLength(base().messages[1]!.members.length);

      // Anchored past the conflicting member, the same group is fine:
      const ok = extendDictionary(base(), {
        fields: {
          NoVenueAttrs: { tag: 5001, type: 'NumInGroup' },
          VenueAttr: { tag: 5002, type: 'String' },
        },
        messages: {
          Quote: {
            append: [{ group: 'NoVenueAttrs', members: ['VenueAttr', 'Text'] }],
            after: 'Text',
          },
        },
      });
      expect(errors(ok.issues)).toEqual([]);
    });

    it('suppresses delimiter-defined when the placement is reverted by a shift', () => {
      const tricky = base();
      tricky.fields[999] = { tag: 999, name: 'NoThings', type: 'NumInGroup', isGroupCounter: true };
      tricky.fields[998] = { tag: 998, name: 'NoStubs', type: 'NumInGroup', isGroupCounter: true };
      tricky.components['EmptyLead'] = { name: 'EmptyLead', members: [] };
      tricky.messages[1]!.members.splice(
        2,
        0,
        {
          kind: 'group',
          counterTag: 999,
          reqd: 'N',
          members: [
            { kind: 'component', name: 'EmptyLead', reqd: 'N' },
            { kind: 'field', tag: 58, reqd: 'Y' },
          ],
        },
        {
          kind: 'group',
          counterTag: 998,
          reqd: 'N',
          members: [{ kind: 'component', name: 'EmptyLead', reqd: 'N' }],
        },
      );
      const { dictionary, issues } = extendDictionary(tricky, {
        fields: { SymbolName: { tag: 5001, type: 'String' } },
        components: { EmptyLead: { append: ['SymbolName'] } },
      });
      // Group 999's delimiter would shift 58 -> 5001: reverted; and although group 998's
      // delimiter would have become defined, that observation must not survive the revert.
      expect(byCode(issues, 'extend/group-delimiter-shift')!.severity).toBe('error');
      expect(byCode(issues, 'extend/delimiter-defined')).toBeUndefined();
      expect(dictionary.components['EmptyLead']!.members).toEqual([]);
    });

    it('warns when a data field is placed without its Length companion before it', () => {
      const unwired = extendDictionary(base(), {
        fields: {
          VenueBlobLen: { tag: 5001, type: 'int' },
          VenueBlob: { tag: 5002, type: 'data', lengthField: 5001 },
        },
        messages: { Quote: { append: ['VenueBlob'] } },
      });
      expect(byCode(unwired.issues, 'extend/data-length-not-placed')!.severity).toBe('warning');

      const wired = extendDictionary(base(), {
        fields: {
          VenueBlobLen: { tag: 5001, type: 'int' },
          VenueBlob: { tag: 5002, type: 'data', lengthField: 5001 },
        },
        messages: { Quote: { append: ['VenueBlobLen', 'VenueBlob'] } },
      });
      expect(byCode(wired.issues, 'extend/data-length-not-placed')).toBeUndefined();
    });

    it('warns when a NumInGroup counter is placed as a plain scalar member', () => {
      const { issues } = extendDictionary(base(), {
        fields: { NoVenueThings: { tag: 5001, type: 'NumInGroup' } },
        messages: { Quote: { append: ['NoVenueThings'] } },
      });
      const warned = byCode(issues, 'extend/counter-as-field')!;
      expect(warned.severity).toBe('warning');
      expect(warned.refTagID).toBe(5001);
    });
  });
});
