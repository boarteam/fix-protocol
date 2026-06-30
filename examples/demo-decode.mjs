// demo-decode.mjs — a small, colorized FIX decoder used to record the README demo.
//
// Everything printed below is *live* output from the `@boarteam/fix` engine — the raw
// wire goes in, the named/typed/validated structure comes out, and malformed input comes
// back as data instead of an exception. Nothing here is mocked, so the recorded demo is
// correct by construction.
//
//   node examples/demo-decode.mjs snapshot   # a clean Market Data Snapshot (35=W)
//   node examples/demo-decode.mjs broken      # a malformed Execution Report (35=8)
//   printf '8=FIX.4.4\x019=...\x01' | node examples/demo-decode.mjs   # decode from stdin
//
import { createFixEngine } from '@boarteam/fix';
import { dictionary } from '@boarteam/fix-dict-fix44';

const SOH = '\x01';

// --- tiny ANSI palette (no deps — matches the project's zero-dependency ethos) ---
const useColor = process.env.NO_COLOR == null && process.env.FORCE_COLOR !== '0';
const sgr = (code) => (s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const dim = sgr('2');
const bold = sgr('1');
const red = sgr('31');
const green = sgr('32');
const yellow = sgr('33');
const blue = sgr('34;1');
const cyan = sgr('36');
const gray = sgr('90');
const white = sgr('97');

// Two illustrative messages. The clean one mirrors the README aha-block; the broken one
// carries exactly the defects the README promises survive parsing without a throw.
const SAMPLES = {
  // Market Data Snapshot / Full Refresh (35=W), EUR/USD, two MD entries. Framed clean,
  // checksum and body-length correct → parse + validate both return zero issues.
  snapshot: [
    '8=FIX.4.4',
    '9=130',
    '35=W',
    '49=SENDER',
    '56=TARGET',
    '34=2',
    '52=20240101-12:00:00.000',
    '55=EUR/USD',
    '268=2',
    '269=0',
    '270=1.0921',
    '271=1000000',
    '269=1',
    '270=1.0923',
    '271=1000000',
    '10=195',
  ].join(SOH),

  // Execution Report (35=8) with three deliberate defects: AvgPx (6) is not a number,
  // OrdStatus (39) is not a valid enum value, and the CheckSum (10) is wrong. The engine
  // returns every one of them as data — it never throws. The remaining fields are exactly
  // the ones the message requires, so `validate` flags the defects and nothing else.
  broken: [
    '8=FIX.4.4',
    '9=000',
    '35=8',
    '49=SENDER',
    '56=TARGET',
    '34=7',
    '52=20240101-12:00:00.000',
    '37=ORD-1',
    '17=EXEC-1',
    '150=F',
    '39=Z',
    '55=EUR/USD',
    '54=1',
    '14=1000000',
    '151=0',
    '6=not-a-number',
    '10=000',
  ].join(SOH),
};

// Short captions shown above each sample so the recording is self-describing when the GIF is
// shared on its own (Show HN, Slack), away from the README caption.
const TITLES = {
  snapshot: 'clean Market Data Snapshot (35=W)',
  broken: 'malformed Execution Report (35=8)',
};

const sevColor = { error: red, warning: yellow, info: blue };
const sevIcon = { error: '✗', warning: '!', info: 'i' };

/** Look up the human label for an enumerated field value, when the dictionary has one. */
function enumLabel(dict, tag, value) {
  const field = dict.fieldByTag(tag);
  const match = field?.enumValues?.find((e) => e.value === String(value));
  return match?.description;
}

/** Render one scalar field as an aligned `tag  Name  value` row. */
function fieldRow(dict, tag, field, indent = '') {
  const tagCol = gray(String(tag).padStart(4));
  const name = (field.name ?? `(tag ${tag})`).padEnd(22);
  const isNum = typeof field.value === 'number';
  const value = isNum ? green(String(field.value)) : white(String(field.value));
  const label = enumLabel(dict, tag, field.raw);
  const note = label ? dim('  ' + label) : '';
  return `${indent}  ${tagCol}  ${cyan(name)}${value}${note}`;
}

/** Wrap a `|`-joined wire string onto lines of at most `width`, breaking after a `|`. */
function wrapWire(wire, width) {
  const lines = [];
  let line = '';
  for (const part of wire.split(/(?<=\|)/)) {
    if (line.length + part.length > width && line) {
      lines.push(line);
      line = '';
    }
    line += part;
  }
  if (line) lines.push(line);
  return lines;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Choose the field separator: the real SOH when present, otherwise `|` for a readable
 * pipe-delimited wire (so a `.fix` sample file or a pasted log line decodes correctly).
 */
function detectSoh(raw) {
  if (raw.includes(SOH)) return undefined; // a real SOH-framed wire — use the default
  if (raw.includes('|')) return '|';
  return undefined;
}

/**
 * Render one decoded message. With `opts.present` the output is revealed in narrated stages
 * with pauses, so the screen recording reads as a guided walkthrough rather than a single
 * instant dump; `opts.brief` then skips the field table and group expansion (the malformed
 * coda only needs the verdict). Plain, non-present output is unchanged and instant — the
 * named samples, the stdin path, and the exported `run()` all keep today's behaviour.
 */
async function printMessage(fix, raw, opts = {}) {
  const { title, present = false, brief = false } = opts;
  const dict = fix.dictionary;
  const soh = detectSoh(raw);
  const wire = raw.split(soh ?? SOH).join('|');
  const pause = (ms) => (present ? sleep(ms) : Promise.resolve());

  // Parse up front (pure, no output) so present-mode narration can react to the result.
  const { message, issues } = soh ? fix.parse(raw, { soh }) : fix.parse(raw); // never throws
  const problems = fix.validate(message);
  const hasDefects = issues.length + problems.length > 0;

  // 1) Frame the message, then show the raw wire.
  if (present) {
    console.log('  ' + dim('@boarteam/fix · runs in the browser & Node · zero dependencies'));
    const intro = hasDefects
      ? 'now a deliberately corrupted message — most FIX parsers throw here:'
      : 'a FIX message, straight from a trading log:';
    console.log('  ' + bold(cyan('▸ ' + intro)));
  } else if (title) {
    console.log(
      '  ' + bold(cyan('▸ ' + title)) + dim('   · @boarteam/fix · zero-dep · browser + Node'),
    );
  } else {
    console.log();
  }
  wrapWire(wire, 74).forEach((line, i) => {
    console.log((i === 0 ? gray('  raw  ') : '       ') + dim(line));
  });
  console.log();
  await pause(1900);

  // 2) The decoded header (msgType → dictionary name).
  if (present) {
    console.log(
      '  ' +
        dim(
          hasDefects
            ? '@boarteam/fix parses it anyway, and reports every defect:'
            : 'decoded — named, typed, and grouped, straight from the dictionary:',
        ),
    );
  }
  const msgName = message.name ?? dict.messageByMsgType(message.msgType)?.name ?? '(unknown)';
  console.log(
    `  ${bold(white(message.msgType || '∅'))}  ${cyan(msgName)}  ` +
      dim(`framed=${message.framed}`),
  );
  console.log(gray('  ───────────────────────────────────────────────'));
  await pause(1300);

  // 3) Scalar fields + 4) repeating groups — shown in full for the hero, skipped for the
  //    brief malformed coda (whose payoff is the diagnostics, not the field dump).
  if (!brief) {
    // Top-level scalar fields (skip the framing tags 8/9/10 to keep the focus on content).
    for (const tag of Object.keys(message.fields)
      .map(Number)
      .sort((a, b) => a - b)) {
      if (tag === 8 || tag === 9 || tag === 10) continue;
      if (dict.isGroupCounter(tag)) continue; // counters are shown with their group below
      console.log(fieldRow(dict, tag, message.fields[tag]));
    }
    await pause(1600);

    // Repeating groups → arrays of nested objects, not parallel arrays.
    const counters = Object.keys(message.groups).map(Number);
    for (const counter of counters) {
      const entries = message.groups[counter];
      const cName = dict.fieldByTag(counter)?.name ?? `group ${counter}`;
      console.log(
        `  ${gray(String(counter).padStart(4))}  ${cyan(cName.padEnd(22))}` +
          bold(`${entries.length} entries`),
      );
      entries.forEach((entry, i) => {
        console.log(`      ${dim('└─ [' + i + ']')}`);
        for (const tag of Object.keys(entry.fields)
          .map(Number)
          .sort((a, b) => a - b)) {
          console.log(fieldRow(dict, tag, entry.fields[tag], '    '));
        }
      });
    }
    if (counters.length) await pause(1800);
  }

  // 5) The verdict — the whole pitch: structure out, every defect as data, no throw. Findings
  // are shown under the call that produced them, mirroring `parse()` then `validate()`.
  const printIssue = (x) => {
    const tint = sevColor[x.severity] ?? white;
    // The message already names the offending field+tag, so the dotted path is omitted here
    // to keep the demo narrow; the structured issue still carries `path` for programmatic use.
    console.log(`    ${tint(sevIcon[x.severity] ?? '·')} ${dim(x.code.padEnd(26))} ${x.message}`);
  };

  await pause(600);
  console.log();
  if (!hasDefects) {
    console.log('  ' + green('✓ parse + validate clean') + dim('  — 0 issues, never threw'));
  } else {
    const n = issues.length + problems.length;
    console.log(
      '  ' + green('✓ never threw') + dim(`  — ${n} defect${n === 1 ? '' : 's'} returned as data:`),
    );
    if (issues.length) {
      console.log('  ' + bold(blue('parse()')) + dim('  →'));
      issues.forEach(printIssue);
    }
    if (problems.length) {
      console.log('  ' + bold(blue('validate()')) + dim('  →'));
      problems.forEach(printIssue);
    }
  }
  console.log();
}

async function readStdin() {
  if (process.stdin.isTTY) return null;
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8').trim();
  return text.length ? text : null;
}

/**
 * Decode one of the named samples and return a compact result — used by the test harness to
 * keep this demo (and the recorded GIF) honest against the real API in CI.
 */
export function run(sample = 'snapshot') {
  const fix = createFixEngine(dictionary);
  const raw = SAMPLES[sample];
  if (raw == null)
    throw new Error(`Unknown sample "${sample}". Try: ${Object.keys(SAMPLES).join(', ')}.`);
  const { message, issues } = fix.parse(raw);
  const problems = fix.validate(message);
  return {
    msgType: message.msgType,
    name: message.name,
    framed: message.framed,
    groupEntries: Object.values(message.groups).reduce((n, g) => n + g.length, 0),
    issueCodes: issues.map((i) => i.code),
    problemCodes: problems.map((p) => p.code),
  };
}

// CLI entrypoint — only when run directly, so importing `run` for tests never blocks on stdin.
if (import.meta.url === `file://${process.argv[1]}`) {
  const fix = createFixEngine(dictionary);
  const args = process.argv.slice(2);
  const present = args.includes('--present'); // staged, paced, narrated reveal (for the recording)
  const brief = args.includes('--brief'); // skip the field table + groups (the malformed coda)
  const sample = args.find((a) => !a.startsWith('--'));
  const piped = await readStdin();

  if (piped) {
    await printMessage(fix, piped, { present, brief });
  } else if (sample && SAMPLES[sample]) {
    await printMessage(fix, SAMPLES[sample], { title: TITLES[sample], present, brief });
  } else if (sample) {
    console.error(
      `Unknown sample "${sample}". Try: ${Object.keys(SAMPLES).join(', ')}, or pipe a message on stdin.`,
    );
    process.exit(1);
  } else {
    // No argument and no stdin → show both, the full before/after the demo records.
    await printMessage(fix, SAMPLES.snapshot, { title: TITLES.snapshot, present, brief });
    console.log(gray('  ' + '═'.repeat(48)));
    await printMessage(fix, SAMPLES.broken, { title: TITLES.broken, present, brief });
  }
}
