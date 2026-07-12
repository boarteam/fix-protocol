// Extend the FIX 4.4 dictionary with venue-custom tags — the cTrader SecurityList case.
//
//   pnpm --filter @boarteam/fix-examples start:extend
//
// cTrader transmits SymbolName(1007)/SymbolDigits(1008) INSIDE the NoRelatedSym
// repeating group of SecurityList (35=y). The stock dictionary doesn't know them there,
// so the group walker closes the group after the first instrument and mis-nests the
// rest. One extension declaration fixes parsing, encoding, AND the typed tag maps.
import {
  createFixEngine,
  defineExtension,
  extendDictionary,
  extendTags,
  invertTags,
  tagsOf,
  validateDictionary,
} from '@boarteam/fix';
import { Tags as Fix44Tags, dictionary as fix44 } from '@boarteam/fix-dict-fix44';

// ONE declaration drives both layers (runtime merge + literal typing):
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

// A 3-instrument SecurityList as cTrader sends it (pipe-delimited log capture).
const raw = [
  '8=FIX.4.4',
  '9=0',
  '35=y',
  '49=cServer',
  '56=client',
  '34=2',
  '52=20240101-12:00:00.000',
  '320=req-1',
  '322=resp-1',
  '560=0',
  '146=3',
  '55=1',
  '1007=EURUSD',
  '1008=5',
  '55=2',
  '1007=GBPUSD',
  '1008=5',
  '55=3',
  '1007=USDJPY',
  '1008=3',
  '10=000',
  '',
].join('|');

/** Run the example and return a small result object (used by the test harness). */
export function run() {
  // Layer 1 — runtime: a NEW dictionary; the base is never mutated. Issues are data.
  const { dictionary, issues } = extendDictionary(fix44, ctrader);
  console.log(`extend issues: ${issues.map((i) => `${i.severity}:${i.code}`).join(', ')}`);
  // -> two info notes that 1007/1008 sit outside the user-defined tag ranges (cTrader
  //    proves venues do this), and one info note that the placement went through the
  //    SecListGrp component. No errors, no warnings.
  const gate = validateDictionary(dictionary); // the same gate as any dictionary
  console.log(`validateDictionary: ${gate.length} issues`);

  const fix = createFixEngine(dictionary);
  const { message, issues: parseIssues } = fix.parse(raw, { soh: '|', checkFraming: false });
  const entries = message.groups?.[146] ?? [];
  console.log(`${entries.length} instruments:`);
  for (const entry of entries) {
    console.log(`  ${entry.fields?.[1007]?.raw} digits=${entry.fields?.[1008]?.value}`);
  }

  // Layer 2 — typing, driven by the SAME declaration. Tags.SymbolName hovers as 1007;
  // TagNames[1007] hovers as 'SymbolName'.
  const Tags = extendTags(Fix44Tags, tagsOf(ctrader));
  const TagNames = invertTags(Tags);
  console.log(`Tags.SymbolName=${Tags.SymbolName}, TagNames[1007]=${TagNames[1007]}`);

  return {
    extendIssues: issues.length,
    extendErrors: issues.filter((i) => i.severity === 'error').length,
    gateIssues: gate.length,
    instruments: entries.length,
    parseIssues: parseIssues.length,
    symbolNameTag: Tags.SymbolName,
    reverseName: TagNames[1007],
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run();
}
