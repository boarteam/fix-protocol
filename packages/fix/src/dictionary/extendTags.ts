/**
 * Typed helpers for extending the literal `Tags`/`MsgType` maps shipped by the
 * dictionary packages (`@boarteam/fix-dict-fix44`, `@boarteam/fix-dict-fix42`) with
 * venue-specific entries — keeping the exact literal typing of the shipped maps
 * (`Tags.SymbolName` hovers as `1007`, not `number`) at zero runtime cost.
 *
 * These are the *map* helpers: total, pure functions over plain `name → tag` /
 * `name → msgType` records, independent of any dictionary. They intentionally emit
 * no issues — a name or tag collision in a map is a data-level problem that
 * `extendDictionary` reports when the same extension is applied to a
 * {@link ./types.DictionaryJSON}; the map layer mirrors object-spread semantics
 * (later entry wins) so types and runtime never disagree.
 *
 * Venue packages that emit declaration files should annotate their exports with the
 * {@link ExtendTags}/{@link InvertTags} alias types: an unannotated export makes tsc
 * inline the full base map *structurally* into the `.d.ts` (hundreds of kilobytes for
 * a FIX 4.4-sized map); the annotation keeps the emit nominal and small.
 */

/**
 * The result of {@link extendTags}: a key-remapped merge where extension keys
 * cleanly REPLACE base keys. Deliberately not a bare intersection — with
 * `B & T`, a name present in both with different tags would collapse to
 * `55 & 9955 = never`; here it types as the extension's literal, matching the
 * runtime spread.
 */
export type ExtendTags<
  B extends Record<string, number>,
  T extends Record<string, number>,
> = Readonly<Omit<B, keyof T> & T>;

/**
 * The result of {@link invertTags}: the precise `tag → name` mapped inversion
 * (so `TagNames[1007]` hovers as its literal name) intersected with the widened
 * index signature the shipped packages use (so `TagNames[someNumber]` is
 * `name | undefined`, never a type error).
 */
export type InvertTags<T extends Record<string, number>> = {
  readonly [K in keyof T as T[K] & number]: K & string;
} & { readonly [tag: number]: (keyof T & string) | undefined };

/** {@link ExtendTags} for `MsgType` maps (`name → msgType` strings). */
export type ExtendMsgTypes<
  B extends Record<string, string>,
  T extends Record<string, string>,
> = Readonly<Omit<B, keyof T> & T>;

/** {@link InvertTags} for `MsgType` maps: `msgType → name` with a string index. */
export type InvertMsgTypes<T extends Record<string, string>> = {
  readonly [K in keyof T as T[K] & string]: K & string;
} & { readonly [msgType: string]: (keyof T & string) | undefined };

/**
 * Merge venue-specific tag entries over a base `Tags` map, keeping every literal
 * type. The `const` type parameter (TS ≥ 5.0) pins call-site literals without
 * `as const`; on a name collision the extension wins (object-spread semantics),
 * and the {@link ExtendTags} result type mirrors that exactly.
 *
 * Pure: returns a new object; never mutates `base` or `ext`.
 *
 * ```ts
 * const Tags = extendTags(Fix44Tags, { SymbolName: 1007, SymbolDigits: 1008 });
 * Tags.SymbolName; // typed 1007
 * type TagName = keyof typeof Tags; // includes 'SymbolName'
 * ```
 *
 * Note: literals survive only for call-site object literals (or `as const`
 * values) — an extension pre-declared as `Record<string, number>` is already
 * widened and yields `number`-typed entries.
 */
export function extendTags<
  B extends Record<string, number>,
  const T extends Record<string, number>,
>(base: B, ext: T): ExtendTags<B, T> {
  return { ...base, ...ext } as ExtendTags<B, T>;
}

/**
 * Build the `tag → name` reverse of a `Tags` map, typed as {@link InvertTags}:
 * literal lookups for known tags plus the shipped packages' widened
 * `name | undefined` number index for arbitrary input.
 *
 * Total and silent by contract: two names sharing one tag resolve last-write-wins
 * (mirroring what a spread-built forward map does); `extendDictionary` is where
 * such collisions are *reported*. For a standalone bijection guarantee, assert
 * `Object.keys(invertTags(m)).length === Object.keys(m).length` in a test, as the
 * shipped packages' `names.test.ts` does.
 */
export function invertTags<const T extends Record<string, number>>(tags: T): InvertTags<T> {
  const out: Record<number, string> = {};
  for (const [name, tag] of Object.entries(tags)) {
    out[tag] = name;
  }
  return out as InvertTags<T>;
}

/**
 * Merge venue-specific message-type entries over a base `MsgType` map — the
 * string-valued mirror of {@link extendTags}.
 *
 * ```ts
 * const MsgType = extendMsgTypes(Fix44MsgType, { CTraderPing: 'UP1' });
 * MsgType.CTraderPing; // typed 'UP1'
 * ```
 */
export function extendMsgTypes<
  B extends Record<string, string>,
  const T extends Record<string, string>,
>(base: B, ext: T): ExtendMsgTypes<B, T> {
  return { ...base, ...ext } as ExtendMsgTypes<B, T>;
}

/**
 * Build the `msgType → name` reverse of a `MsgType` map — the string-valued
 * mirror of {@link invertTags}.
 */
export function invertMsgTypes<const T extends Record<string, string>>(
  msgTypes: T,
): InvertMsgTypes<T> {
  const out: Record<string, string> = {};
  for (const [name, msgType] of Object.entries(msgTypes)) {
    out[msgType] = name;
  }
  return out as InvertMsgTypes<T>;
}
