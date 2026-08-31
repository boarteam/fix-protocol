/**
 * The shared tiny dictionary behind the typed-message tests (`message.test.ts` on the
 * write side, `inbound.test.ts` on the read side), kept out of both so neither owns it.
 *
 * A `.fixture.ts` rather than a `.test.ts`: importing a test file would re-register its
 * suites in every importer.
 */
import { Dictionary, loadDictionary } from './dictionary/Dictionary';
import type { DictionaryJSON } from './dictionary/types';

/**
 * A FIX.4.4-shaped tiny dictionary with a header/trailer, a scalar-heavy Logon, and a
 * nested-group message — enough to exercise name→tag conversion, envelope merge, and
 * repeating-group rendering without the full generated dictionary.
 */
export function tinyDict(): DictionaryJSON {
  const f = (tag: number, name: string, type: string, isGroupCounter = false) => ({
    tag,
    name,
    type,
    ...(isGroupCounter ? { isGroupCounter: true } : {}),
  });
  return {
    version: 'FIX.4.4',
    beginString: 'FIX.4.4',
    datatypes: {
      String: { name: 'String', base: 'String' },
      int: { name: 'int', base: 'int' },
      char: { name: 'char', base: 'char' },
      Boolean: { name: 'Boolean', base: 'char' },
      NumInGroup: { name: 'NumInGroup', base: 'int' },
    },
    fields: {
      8: f(8, 'BeginString', 'String'),
      9: f(9, 'BodyLength', 'int'),
      35: f(35, 'MsgType', 'String'),
      49: f(49, 'SenderCompID', 'String'),
      56: f(56, 'TargetCompID', 'String'),
      34: f(34, 'MsgSeqNum', 'int'),
      52: f(52, 'SendingTime', 'String'),
      115: f(115, 'OnBehalfOfCompID', 'String'),
      10: f(10, 'CheckSum', 'String'),
      98: f(98, 'EncryptMethod', 'int'),
      108: f(108, 'HeartBtInt', 'int'),
      141: f(141, 'ResetSeqNumFlag', 'Boolean'),
      58: f(58, 'Text', 'String'),
      55: f(55, 'Symbol', 'String'),
      268: f(268, 'NoMDEntries', 'NumInGroup', true),
      269: f(269, 'MDEntryType', 'char'),
      270: f(270, 'MDEntryPx', 'String'),
      453: f(453, 'NoPartyIDs', 'NumInGroup', true),
      448: f(448, 'PartyID', 'String'),
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
          { kind: 'field', tag: 52, reqd: 'Y' },
          { kind: 'field', tag: 115, reqd: 'N' },
        ],
      },
      'Standard Message Trailer': {
        name: 'Standard Message Trailer',
        members: [{ kind: 'field', tag: 10, reqd: 'Y' }],
      },
    },
    messages: [
      {
        name: 'Logon',
        msgType: 'A',
        category: 'admin',
        members: [
          { kind: 'component', name: 'Standard Message Header', reqd: 'Y' },
          { kind: 'field', tag: 98, reqd: 'Y' },
          { kind: 'field', tag: 108, reqd: 'Y' },
          { kind: 'field', tag: 141, reqd: 'N' },
          { kind: 'field', tag: 58, reqd: 'N' },
          { kind: 'component', name: 'Standard Message Trailer', reqd: 'Y' },
        ],
      },
      {
        name: 'MarketDataSnapshotFullRefresh',
        msgType: 'W',
        category: 'app',
        members: [
          { kind: 'component', name: 'Standard Message Header', reqd: 'Y' },
          { kind: 'field', tag: 55, reqd: 'N' },
          {
            kind: 'group',
            counterTag: 268,
            reqd: 'Y',
            members: [
              { kind: 'field', tag: 269, reqd: 'Y' },
              { kind: 'field', tag: 270, reqd: 'N' },
              {
                kind: 'group',
                counterTag: 453,
                reqd: 'N',
                members: [{ kind: 'field', tag: 448, reqd: 'Y' }],
              },
            ],
          },
          { kind: 'field', tag: 58, reqd: 'N' },
          { kind: 'component', name: 'Standard Message Trailer', reqd: 'Y' },
        ],
      },
    ],
  } as unknown as DictionaryJSON;
}

/** The loaded index over {@link tinyDict}, shared by every test that reads it. */
export const dict: Dictionary = loadDictionary(tinyDict());

// A loose body shape for the tiny dict — the real dicts ship generated per-message types.
export interface LogonBody {
  EncryptMethod: number | string;
  HeartBtInt: number | string;
  ResetSeqNumFlag?: boolean;
  Text?: string;
}
export interface MDEntry {
  MDEntryType: string;
  MDEntryPx?: string;
  NoPartyIDs?: { PartyID: string }[];
}
export interface MDSnapshotBody {
  Symbol?: string;
  NoMDEntries: MDEntry[];
  Text?: string;
}
export interface TinyBodies {
  A: LogonBody;
  W: MDSnapshotBody;
}
