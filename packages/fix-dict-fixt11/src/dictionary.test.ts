import { describe, expect, it } from 'vitest';
import { loadDictionary, validateDictionary } from '@boarteam/fix';
import { dictionary, MsgType, MsgTypeNames, TagNames, Tags } from './index';

const dict = loadDictionary(dictionary);

describe('FIXT.1.1 dictionary — integrity', () => {
  it('is internally consistent (no validation errors or warnings)', () => {
    expect(validateDictionary(dictionary)).toEqual([]);
  });

  it('has the transport-layer surface: envelope + 7 session messages', () => {
    expect(dictionary.version).toBe('FIXT.1.1');
    expect(dictionary.beginString).toBe('FIXT.1.1');
    // Transport dictionaries are app-version-agnostic: no applVerID.
    expect(dictionary.applVerID).toBeUndefined();
    expect(Object.keys(dictionary.fields).length).toBe(74);
    expect(dictionary.messages.length).toBe(7);
    expect(dictionary.messages.every((m) => m.category === 'admin')).toBe(true);
    expect(Object.keys(dictionary.components).sort()).toEqual([
      'HopGrp',
      'MsgTypeGrp',
      'Standard Message Header',
      'Standard Message Trailer',
    ]);
  });

  it('ships exactly the 7 QuickFIX/J session messages — no XMLnonFIX(n) (see README)', () => {
    expect(dictionary.messages.map((m) => m.msgType).sort()).toEqual([
      '0',
      '1',
      '2',
      '3',
      '4',
      '5',
      'A',
    ]);
    expect(dict.messageByMsgType('n')).toBeUndefined();
  });

  it('the header carries the FIXT app-versioning fields and the HopGrp', () => {
    const header = dictionary.components['Standard Message Header']!;
    expect(header.members).toHaveLength(30);
    const tags = header.members.filter((m) => m.kind === 'field').map((m) => m.tag);
    expect(tags.slice(0, 3)).toEqual([8, 9, 35]);
    for (const t of [1128, 1129, 1156]) {
      expect(tags, `header carries ${t}`).toContain(t);
    }
    expect(header.members.some((m) => m.kind === 'component' && m.name === 'HopGrp')).toBe(true);
  });

  it('Logon (A) requires DefaultApplVerID(1137) and knows the MsgTypeGrp', () => {
    const logon = dict.messageByMsgType('A')!;
    expect(logon.members).toContainEqual({ kind: 'field', tag: 1137, reqd: 'Y' });
    expect(logon.members).toContainEqual({ kind: 'component', name: 'MsgTypeGrp', reqd: 'N' });
    expect(dict.allowedTags('A')).toContain(384); // NoMsgTypes
  });

  it('links the envelope data fields to their Length companions', () => {
    expect(dictionary.fields[89]!.lengthField).toBe(93); // Signature
    expect(dictionary.fields[91]!.lengthField).toBe(90); // SecureData
    expect(dictionary.fields[213]!.lengthField).toBe(212); // XmlData
    expect(dictionary.fields[96]!.lengthField).toBe(95); // RawData (Logon body)
  });

  it('ApplVerID(1128) and SessionRejectReason(373) carry their enum tables', () => {
    const applVer = dictionary.fields[1128]!.enumValues!.map((v) => v.value);
    expect(applVer).toContain('9'); // FIX50SP2
    expect(applVer).toContain('10'); // FIXLatest
    expect(dictionary.fields[373]!.enumValues!.length).toBeGreaterThanOrEqual(18);
  });
});

describe('FIXT.1.1 dictionary — name maps', () => {
  it('Tags/TagNames and MsgType/MsgTypeNames are exact inverses', () => {
    const names = Object.keys(Tags) as (keyof typeof Tags)[];
    expect(Object.keys(TagNames)).toHaveLength(names.length);
    for (const name of names) {
      expect(TagNames[Tags[name]]).toBe(name);
    }
    const msgNames = Object.keys(MsgType) as (keyof typeof MsgType)[];
    for (const name of msgNames) {
      expect(MsgTypeNames[MsgType[name]]).toBe(name);
    }
  });

  it('resolves the session vocabulary', () => {
    expect(Tags.DefaultApplVerID).toBe(1137);
    expect(TagNames[1128]).toBe('ApplVerID');
    expect(MsgType.Logon).toBe('A');
    expect(MsgTypeNames['4']).toBe('SequenceReset');
    // Transport-only dictionary: no application message types.
    expect(MsgTypeNames['D']).toBeUndefined();
  });
});
