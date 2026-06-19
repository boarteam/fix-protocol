/**
 * `@boarteam/fix` — a dictionary-driven FIX protocol toolkit.
 *
 * Parse, validate, and encode FIX messages with zero runtime dependencies, in the
 * browser or Node. See the README and `docs/PROJECT_PLAN.md` for the roadmap; this
 * package is in early (0.x) development.
 */

export const VERSION = '0.1.0-alpha.0';

export { calculateChecksum, bodyLength } from './codec/checksum';
