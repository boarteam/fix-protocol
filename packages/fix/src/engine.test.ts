import { describe, expect, it } from 'vitest';
import type { DictionaryJSON } from './dictionary/types';
import { createFixEngine } from './engine';
import { loadDictionary } from './dictionary/Dictionary';

function tinyDict(): DictionaryJSON {
  return {
    version: 'FIX.4.4',
    beginString: 'FIX.4.4',
    datatypes: {
      String: { name: 'String', base: 'String' },
      int: { name: 'int', base: 'int' },
    },
    fields: {
      8: { tag: 8, name: 'BeginString', type: 'String' },
      9: { tag: 9, name: 'BodyLength', type: 'int' },
      35: { tag: 35, name: 'MsgType', type: 'String' },
      49: { tag: 49, name: 'SenderCompID', type: 'String' },
      56: { tag: 56, name: 'TargetCompID', type: 'String' },
      34: { tag: 34, name: 'MsgSeqNum', type: 'int' },
      10: { tag: 10, name: 'CheckSum', type: 'String' },
    },
    components: {
      'Standard Message Header': {
        name: 'Standard Message Header',
        members: [
          { kind: 'field', tag: 8, reqd: 'Y' },
          { kind: 'field', tag: 9, reqd: 'Y' },
          { kind: 'field', tag: 35, reqd: 'Y' },
          { kind: 'field', tag: 49, reqd: 'Y' },
          { kind: 'field', tag: 56, reqd: 'Y' },
          { kind: 'field', tag: 34, reqd: 'Y' },
        ],
      },
      'Standard Message Trailer': {
        name: 'Standard Message Trailer',
        members: [{ kind: 'field', tag: 10, reqd: 'Y' }],
      },
    },
    messages: [
      {
        name: 'Heartbeat',
        msgType: '0',
        category: 'admin',
        members: [
          { kind: 'component', name: 'Standard Message Header', reqd: 'Y' },
          { kind: 'component', name: 'Standard Message Trailer', reqd: 'Y' },
        ],
      },
    ],
  };
}

describe('createFixEngine', () => {
  it('binds the dictionary and round-trips parse(encode(...))', () => {
    const fix = createFixEngine(tinyDict());
    const raw = fix.encode({ msgType: '0', fields: { 49: 'A', 56: 'B', 34: 1 } });
    const { message, issues } = fix.parse(raw);
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(message.msgType).toBe('0');
    expect(message.fields[49]?.value).toBe('A');
  });

  it('accepts a pre-loaded Dictionary instance too', () => {
    const dict = loadDictionary(tinyDict());
    const fix = createFixEngine(dict);
    expect(fix.dictionary).toBe(dict);
  });

  it('applies the default soh, and a per-call explicit undefined does not clobber it', () => {
    const fix = createFixEngine(tinyDict(), { soh: '|' });
    // Encoded with '|', the engine must parse it back with its default '|' separator…
    const raw = fix.encode({ msgType: '0', fields: { 49: 'A', 56: 'B', 34: 1 } });
    expect(raw).toContain('|35=0|');

    // …even when the caller forwards an options bag whose soh is explicitly undefined.
    const { message } = fix.parse(raw, { soh: undefined });
    expect(message.fields[49]?.value).toBe('A');
  });

  it('honours a per-call soh override', () => {
    const fix = createFixEngine(tinyDict()); // default SOH
    const raw = fix.encode({ msgType: '0', fields: { 49: 'A', 56: 'B', 34: 1 } }, { soh: '|' });
    const { message } = fix.parse(raw, { soh: '|' });
    expect(message.fields[56]?.value).toBe('B');
  });
});
