const decoder = new TextDecoder();

/** The FIX field separator (`SOH`, ASCII 0x01). */
export const SOH = '\x01';

/**
 * A single decoded FIX field: its numeric tag and its raw, still-encoded value.
 *
 * The value is the verbatim characters between `=` and the terminating `SOH`; no
 * datatype coercion, trimming, or enum resolution is applied here (that is the
 * dictionary-driven parser's job). The tag is `NaN` when the tag portion was not a
 * valid integer — callers decide whether that is an error.
 */
export type Token = [tag: number, value: string];

export interface TokenizeOptions {
  /** Field separator. Defaults to {@link SOH}. Pass `'|'` to read pipe-delimited logs. */
  soh?: string;
}

/**
 * Split a raw FIX message into ordered `[tag, value]` pairs.
 *
 * This is a purely lexical pass: it preserves field order (so repeating groups can be
 * reconstructed downstream), keeps duplicate tags as separate entries, and never throws.
 * Two correctness fixes over the original implementation:
 *
 * - **`=` in values.** The tag/value boundary is the *first* `=`, found with
 *   {@link String.indexOf}, not `split('=')` — so a value that itself contains `=`
 *   (common in `data`/`Text` payloads and Base64) survives intact.
 * - **Bytes in, text out.** A `Uint8Array` is decoded as UTF-8, so non-ASCII field
 *   values round-trip without `Buffer`.
 *
 * Note: a trailing separator after the final field (the normal on-the-wire form) yields
 * no empty token; input with no separators yields at most one token. Length-prefixed
 * `data` fields whose value embeds a raw `SOH` are not special-cased here — that requires
 * dictionary knowledge and is handled by the parser.
 *
 * @param raw The message as a string or UTF-8 bytes.
 * @param options Optional separator override.
 * @returns Ordered `[tag, value]` tokens; an empty array for empty input.
 */
export function tokenize(raw: string | Uint8Array, options: TokenizeOptions = {}): Token[] {
  const soh = options.soh ?? SOH;
  const text = typeof raw === 'string' ? raw : decoder.decode(raw);
  if (text.length === 0) {
    return [];
  }

  const tokens: Token[] = [];
  const segments = text.split(soh);
  for (const segment of segments) {
    if (segment.length === 0) {
      // Skip empty segments from the trailing separator (or doubled separators).
      continue;
    }
    const eq = segment.indexOf('=');
    if (eq === -1) {
      // A segment with no '=' is not a well-formed field; surface it as a NaN tag so
      // the parser can report it rather than silently dropping data.
      tokens.push([Number.NaN, segment]);
      continue;
    }
    const tag = parseTag(segment.slice(0, eq));
    const value = segment.slice(eq + 1);
    tokens.push([tag, value]);
  }
  return tokens;
}

/**
 * Parse a tag string into a non-negative integer, returning `NaN` for anything that is
 * not a run of ASCII digits. Unlike {@link Number}, this rejects `'1.5'`, `'0x1'`,
 * `' 1'`, and `''` — FIX tags are bare positive integers.
 */
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
  // Reject magnitudes that lose integer precision (so two distinct wire tags can never
  // collapse to one numeric key). Real FIX tags are far below this bound.
  return Number.isSafeInteger(tag) ? tag : Number.NaN;
}
