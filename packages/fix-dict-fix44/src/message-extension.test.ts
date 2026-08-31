/**
 * End-to-end example of the recommended extension-typing mechanism (task decision #2):
 * layer a venue's own tags onto an EXISTING message's typed body WITHOUT regenerating a
 * dictionary. The motivating case is cTrader, which carries SymbolName(1007)/SymbolDigits(1008)
 * inside SecurityList's NoRelatedSym repeating group.
 *
 * The mechanism has two halves that must ship as a PAIR:
 *  - runtime: `extendDictionary(dictionary, ext).dictionary` adds the fields + placements, and
 *    the message factory is rebound to that extended dictionary (`messageFactory(extended)`);
 *  - types: the venue augments the generated, container-scoped `SecListGrp_NoRelatedSymEntry`
 *    interface via declaration merging. Because the runtime fans the placement out through the
 *    SHARED `SecListGrp` component, patching that one shared interface makes the types track the
 *    runtime exactly — every message composing the component sees the new fields.
 *
 * This is the single-venue-per-process form (module augmentation is global). For a process
 * bridging two venues over the same dialect, intersect a hand-written override interface into a
 * distinct `ExtendedBodies` type instead (see the README).
 */
import {
  createFixEngine,
  defineExtension,
  extendDictionary,
  inboundTypeGuard,
  messageFactory,
} from '@boarteam/fix';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { type MessageBodies, dictionary } from './index';

// The venue declaration — ONE source of truth for both halves (unchanged from extend.test.ts).
const ctrader = defineExtension({
  id: 'ctrader',
  fields: {
    SymbolName: { tag: 1007, type: 'String' },
    SymbolDigits: { tag: 1008, type: 'int' },
  },
  messages: {
    SecurityList: { groups: { NoRelatedSym: { append: ['SymbolName', 'SymbolDigits'] } } },
  },
});

const { dictionary: extended } = extendDictionary(dictionary, ctrader);

// --- the type seam: augment the generated container-scoped entry interface -----------------
declare module './index' {
  interface SecListGrp_NoRelatedSymEntry {
    /** cTrader tag 1007. */
    SymbolName?: string;
    /** cTrader tag 1008 (int → number | string). */
    SymbolDigits?: number | string;
  }
}

// Rebind the factory to the EXTENDED dictionary — the augmented TYPE and the extended VALUE
// travel together. `MessageBodies` now reflects the augmentation through `SecListGrpFields`.
const message = messageFactory<MessageBodies>(extended);

const ENV = {
  SenderCompID: 'cServer',
  TargetCompID: 'client',
  MsgSeqNum: 2,
  SendingTime: '20260712-09:00:00',
};

describe('typed extension: cTrader SymbolName(1007) placed into an existing message', () => {
  it('accepts the venue fields on the augmented group entry (type-level)', () => {
    const wire = message('y', {
      SecurityReqID: 'req-1',
      SecurityResponseID: 'resp-1',
      SecurityRequestResult: 0,
    })
      .set('NoRelatedSym', [
        { Symbol: '1', SymbolName: 'EURUSD', SymbolDigits: '5' },
        { Symbol: '2', SymbolName: 'GBPUSD', SymbolDigits: 5 },
        { Symbol: '3', SymbolName: 'USDJPY', SymbolDigits: '3' },
      ])
      .render(ENV);

    // Each entry carries its own 1007/1008, placed inside the group by the extended dict.
    expect(wire.match(/\x011007=/g)).toHaveLength(3);
    expect(wire.match(/\x011008=/g)).toHaveLength(3);
    expect(wire).toContain('1007=EURUSD');
  });

  it('round-trips through the extended engine', () => {
    const engine = createFixEngine(extended);
    const wire = message('y', {
      SecurityReqID: 'req-1',
      SecurityResponseID: 'resp-1',
      SecurityRequestResult: 0,
    })
      .set('NoRelatedSym', [
        { Symbol: '1', SymbolName: 'EURUSD', SymbolDigits: '5' },
        { Symbol: '2', SymbolName: 'GBPUSD', SymbolDigits: '5' },
      ])
      .render(ENV);
    const { message: parsed, issues } = engine.parse(wire);
    expect(issues).toEqual([]);
    const entries = parsed.groups[146]!;
    expect(entries.map((e) => e.fields[1007]!.raw)).toEqual(['EURUSD', 'GBPUSD']);
    expect(entries.map((e) => e.fields[55]!.raw)).toEqual(['1', '2']);
  });

  it('reads the venue fields back through the typed inbound view', () => {
    // The read-side half of the same seam: the augmentation that made SymbolName settable
    // also makes it readable, because `toInbound` keys the body by dictionary name and the
    // extension put 1007/1008 inside NoRelatedSym. Compare with the round-trip above, which
    // digs the same values out of `groups[146][i].fields[1007].raw` by hand.
    const engine = createFixEngine<MessageBodies>(extended);
    const isInboundType = inboundTypeGuard<MessageBodies>();
    const wire = message('y', {
      SecurityReqID: 'req-1',
      SecurityResponseID: 'resp-1',
      SecurityRequestResult: 0,
    })
      .set('NoRelatedSym', [
        { Symbol: '1', SymbolName: 'EURUSD', SymbolDigits: 5 },
        { Symbol: '2', SymbolName: 'GBPUSD', SymbolDigits: 3 },
      ])
      .render(ENV);

    const inbound = engine.inbound(engine.parse(wire).message);
    if (isInboundType(inbound, 'y')) {
      const entries = inbound.get('NoRelatedSym');
      expect(entries?.map((e) => e.SymbolName)).toEqual(['EURUSD', 'GBPUSD']);
      expect(entries?.map((e) => e.Symbol)).toEqual(['1', '2']);
      // `int` decodes to a number on the way in, where the entry type widens it for the
      // build side.
      expect(entries?.[0]?.SymbolDigits).toBe(5);
      expectTypeOf(entries?.[0]?.SymbolName).toEqualTypeOf<string | undefined>();
      // The session envelope of the received message, off to the side as always.
      expect(inbound.envelope.SenderCompID).toBe('cServer');
    } else {
      expect.unreachable('y should have narrowed');
    }
  });

  it('exposes the venue fields on the entry type', () => {
    const w = message('y');
    // The augmented fields are settable on the entry — this line typechecks only because of
    // the `declare module` augmentation above:
    w.set('NoRelatedSym', [{ Symbol: 'X', SymbolName: 'EURUSD', SymbolDigits: 5 }]);
    const entry = w.get('NoRelatedSym')?.[0];
    expect(entry?.SymbolName).toBe('EURUSD'); // read the augmented field back at runtime
    expectTypeOf<NonNullable<typeof entry>['SymbolName']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<NonNullable<typeof entry>['SymbolDigits']>().toEqualTypeOf<
      number | string | undefined
    >();
    // @ts-expect-error a still-unknown venue field is rejected
    w.set('NoRelatedSym', [{ SymbolNam: 'typo' }]);
  });
});
