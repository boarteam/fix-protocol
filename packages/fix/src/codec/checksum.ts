const encoder = new TextEncoder();

function toBytes(input: string | Uint8Array): Uint8Array {
  return typeof input === 'string' ? encoder.encode(input) : input;
}

/**
 * FIX `CheckSum` (tag 10): the sum of all bytes of the message — from `BeginString`
 * up to and including the `SOH` immediately preceding the checksum field — taken
 * modulo 256 and rendered as a zero-padded three-digit string.
 *
 * The sum is computed over UTF-8 **bytes**, not JavaScript string code units, so a
 * message containing non-ASCII field values (for example an `EncodedText` payload)
 * yields a spec-correct checksum. This is the correctness fix over the original
 * implementation, which summed `String.prototype.charCodeAt` code units.
 *
 * @param message The message bytes (or a string, encoded as UTF-8) to checksum.
 * @returns The checksum as a three-character, zero-padded decimal string (`"000"`–`"255"`).
 */
export function calculateChecksum(message: string | Uint8Array): string {
  const bytes = toBytes(message);
  let sum = 0;
  for (let i = 0; i < bytes.length; i++) {
    sum = (sum + bytes[i]!) & 0xff;
  }
  return sum.toString().padStart(3, '0');
}

/**
 * FIX `BodyLength` (tag 9): the number of bytes in the message following the
 * `BodyLength` field's terminating `SOH`, up to and including the `SOH` immediately
 * preceding the `CheckSum` field.
 *
 * Measured in UTF-8 **bytes**, not string length, for the same reason as
 * {@link calculateChecksum}.
 *
 * @param body The portion of the message the body length covers.
 * @returns The body length in bytes.
 */
export function bodyLength(body: string | Uint8Array): number {
  return toBytes(body).length;
}
