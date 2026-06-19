/**
 * `@boarteam/fix-codegen` — generates the FIX dictionary JSON consumed by
 * `@boarteam/fix-dict-fix44`.
 *
 * Planned sources (M1 / M4):
 *  - Markdown FIX 4.4 reference (primary) — parses `fields/`, `components/`, `messages/`,
 *    and `data-types.md` into one `DictionaryJSON`.
 *  - QuickFIX `FIX44.xml` (canonical cross-check) — used to detect spec drift in CI.
 *
 * Node-only build tool; never shipped to consumers.
 */

export {};
