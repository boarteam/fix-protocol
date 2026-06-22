import type { Dictionary } from '../dictionary/Dictionary';
import { SOH, type Token } from './tokenize';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBytes(input: string | Uint8Array): Uint8Array {
  return typeof input === 'string' ? encoder.encode(input) : input;
}

export interface FrameOptions {
  /** Field separator. Defaults to {@link SOH}. Must be a single byte (e.g. `SOH` or `'|'`). */
  soh?: string;
}

/**
 * Split a buffer that may hold several concatenated FIX messages into one byte slice per
 * message. This fixes the legacy behaviour where only the first message in a buffer
 * survived.
 *
 * Boundaries are computed from each message's `BodyLength` (tag 9), which is the only
 * robust method: a `data` field value may itself embed the `SOH` separator or even a
 * `8=`/`10=` byte sequence, so scanning for those markers would mis-split. The math is
 * byte-accurate (operates on UTF-8 bytes, not string code units). When a message's
 * `BodyLength` is missing or unusable, it falls back to slicing up to the next
 * `SOH`+`8=` boundary so malformed input still degrades gracefully instead of being lost.
 *
 * Leading/trailing bytes outside any `8=…10=` frame are ignored. Never throws.
 *
 * @returns one `Uint8Array` per detected message, in order; empty for empty input.
 */
export function splitMessages(raw: string | Uint8Array, options: FrameOptions = {}): Uint8Array[] {
  const bytes = toBytes(raw);
  if (bytes.length === 0) {
    return [];
  }
  const sohByte = sohByteOf(options.soh);
  const messages: Uint8Array[] = [];

  let cursor = 0;
  while (cursor < bytes.length) {
    const start = findFieldStart(bytes, BEGIN_STRING_TAG, cursor, sohByte, bytes.length);
    if (start === -1) {
      break; // no further `8=` field: only trailing junk remains
    }

    // The next `8=` boundary bounds the BodyLength search, keeping the whole split O(n):
    // the real `9=` is always the second field (right after this `8=`), well before any
    // later `8=` — including a fake one embedded in a `data` payload.
    const next8 = findFieldStart(bytes, BEGIN_STRING_TAG, start + 2, sohByte, bytes.length);
    const limit = next8 === -1 ? bytes.length : next8;

    const end = messageEnd(bytes, start, sohByte, limit);
    if (end === -1) {
      // BodyLength unusable: slice to the next message boundary (or the end of the buffer).
      messages.push(bytes.slice(start, limit));
      cursor = limit;
      continue;
    }

    // `end` may legitimately exceed `limit` when `next8` was a fake `8=` inside this
    // message's data payload — the BodyLength-derived end is authoritative.
    messages.push(bytes.slice(start, end));
    cursor = end;
  }

  return messages;
}

/**
 * Tokenize a single message into ordered `[tag, value]` pairs with **length-aware**
 * handling of `data` fields: when a `Length` field (one that some `data` field points to
 * via {@link FieldDef.lengthField}) is read, the immediately following `data` field's value
 * is taken as exactly that many UTF-8 bytes — even if it contains the `SOH` separator — so
 * binary payloads survive intact. For every other field this matches {@link tokenize}.
 *
 * Like {@link tokenize}, it is purely lexical and never throws: it preserves field order
 * and duplicates, skips empty segments, and emits a `NaN` tag for a segment with no `=`.
 *
 * @param raw The single message as a string or UTF-8 bytes.
 * @param dict The dictionary, used to locate `Length`→`data` field pairs.
 * @param options Optional separator override.
 */
export function scanFields(
  raw: string | Uint8Array,
  dict: Dictionary,
  options: FrameOptions = {},
): Token[] {
  const bytes = toBytes(raw);
  const tokens: Token[] = [];
  if (bytes.length === 0) {
    return tokens;
  }
  const sohByte = sohByteOf(options.soh);
  const lengthToData = lengthFieldMap(dict);

  let i = 0;
  let pendingDataTag: number | undefined;
  let pendingLen: number | undefined;

  while (i < bytes.length) {
    // Read the tag: bytes up to the first '=' or separator.
    const tagStart = i;
    while (i < bytes.length && bytes[i] !== EQUALS && bytes[i] !== sohByte) {
      i++;
    }
    if (i >= bytes.length) {
      // Trailing bytes with no '=' and no terminator: a malformed final segment.
      if (i > tagStart) {
        tokens.push([Number.NaN, decoder.decode(bytes.subarray(tagStart, i))]);
      }
      break;
    }
    if (bytes[i] === sohByte) {
      // Segment terminated before any '=': empty segment (doubled separator) or junk.
      if (i > tagStart) {
        tokens.push([Number.NaN, decoder.decode(bytes.subarray(tagStart, i))]);
      }
      i++; // skip separator
      continue;
    }

    // bytes[i] === '='
    const tag = parseTag(decoder.decode(bytes.subarray(tagStart, i)));
    i++; // skip '='
    const valueStart = i;

    const dataLen =
      pendingDataTag !== undefined && pendingLen !== undefined && tag === pendingDataTag
        ? pendingLen
        : undefined;
    pendingDataTag = undefined;
    pendingLen = undefined;

    let valueEnd: number;
    if (dataLen !== undefined) {
      // Consume exactly N bytes regardless of embedded separators.
      valueEnd = Math.min(valueStart + dataLen, bytes.length);
    } else {
      let j = valueStart;
      while (j < bytes.length && bytes[j] !== sohByte) {
        j++;
      }
      valueEnd = j;
    }

    const value = decoder.decode(bytes.subarray(valueStart, valueEnd));
    tokens.push([tag, value]);

    i = valueEnd;
    if (i < bytes.length && bytes[i] === sohByte) {
      i++; // skip the terminating separator
    }

    // If this field is a Length field, arm the next field for length-aware reading.
    const dataTag = lengthToData.get(tag);
    if (dataTag !== undefined && /^\d+$/.test(value)) {
      const n = Number(value);
      if (Number.isSafeInteger(n) && n >= 0) {
        pendingDataTag = dataTag;
        pendingLen = n;
      }
    }
  }

  return tokens;
}

// --- internals -------------------------------------------------------------------------

const BEGIN_STRING_TAG = encoder.encode('8='); // [0x38, 0x3D]
const EQUALS = 0x3d; // '='
const ZERO = 0x30; // '0'
const NINE = 0x39; // '9'

function sohByteOf(soh: string | undefined): number {
  if (soh === undefined) {
    return SOH.charCodeAt(0);
  }
  const bytes = encoder.encode(soh);
  return bytes.length > 0 ? bytes[0]! : SOH.charCodeAt(0);
}

/**
 * Index of a `tag=` field start in `[from, to)`, anchored to the buffer start or a
 * separator. The `to` bound keeps callers from scanning to EOF on every message.
 */
function findFieldStart(
  bytes: Uint8Array,
  needle: Uint8Array,
  from: number,
  sohByte: number,
  to: number,
): number {
  const last = Math.min(to, bytes.length - needle.length + 1);
  for (let i = Math.max(0, from); i < last; i++) {
    if (i !== 0 && bytes[i - 1] !== sohByte) {
      continue; // a field starts only at the buffer head or right after a separator
    }
    if (matchesAt(bytes, needle, i)) {
      return i;
    }
  }
  return -1;
}

function matchesAt(bytes: Uint8Array, needle: Uint8Array, at: number): boolean {
  for (let k = 0; k < needle.length; k++) {
    if (bytes[at + k] !== needle[k]) {
      return false;
    }
  }
  return true;
}

/**
 * Compute the exclusive end index of the message that starts at `start`, from its
 * `BodyLength` field. Returns -1 when the frame cannot be measured (no `9=`, non-numeric
 * length, or the computed end overruns the buffer / does not land on a `10=` field).
 */
function messageEnd(bytes: Uint8Array, start: number, sohByte: number, limit: number): number {
  // Find the BodyLength field: a `9=` immediately after a separator, after `start`. Bounded
  // to `limit` (the next `8=`) — the real `9=` is always within the first few bytes here.
  const nineNeedle = encoder.encode('9=');
  const ninePos = findFieldStart(bytes, nineNeedle, start, sohByte, limit);
  if (ninePos === -1) {
    return -1;
  }
  let p = ninePos + nineNeedle.length;
  let n = 0;
  let digits = 0;
  for (; p < bytes.length; p++) {
    const b = bytes[p]!;
    if (b < ZERO || b > NINE) {
      break;
    }
    n = n * 10 + (b - ZERO);
    digits++;
    if (n > 0x7fffffff) {
      return -1; // implausibly large length
    }
  }
  if (digits === 0 || p >= bytes.length || bytes[p] !== sohByte) {
    return -1; // no digits, or the length field is not separator-terminated
  }
  const bodyStart = p + 1;
  const checkSumStart = bodyStart + n; // body covers up to & incl. the SOH before CheckSum
  // CheckSum field is `10=` + 3 digits + separator = 7 bytes.
  const end = checkSumStart + 7;
  if (end > bytes.length) {
    return -1;
  }
  const tenNeedle = encoder.encode('10=');
  if (!matchesAt(bytes, tenNeedle, checkSumStart)) {
    return -1; // BodyLength does not land on the CheckSum field
  }
  return end;
}

/** Map each `Length` field tag to the `data` field tag that follows it. */
function lengthFieldMap(dict: Dictionary): Map<number, number> {
  const map = new Map<number, number>();
  for (const field of Object.values(dict.json.fields)) {
    if (field.lengthField !== undefined) {
      map.set(field.lengthField, field.tag);
    }
  }
  return map;
}

/** Parse a tag string into a non-negative integer, or `NaN` for non-digit runs. */
function parseTag(raw: string): number {
  if (raw.length === 0) {
    return Number.NaN;
  }
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    if (code < 0x30 || code > 0x39) {
      return Number.NaN;
    }
  }
  const tag = Number(raw);
  return Number.isSafeInteger(tag) ? tag : Number.NaN;
}
