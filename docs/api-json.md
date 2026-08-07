# `dist/api.json` — the API model the package ships

Since 0.5.0 the `@boarteam/fix` tarball carries `dist/api.json`: a machine-readable
model of the public surface, emitted by `packages/fix/scripts/emit-api.mjs` as part
of `pnpm build` (after tsup). Consumers — the first is boar.team's generated
[API reference](https://boar.team/fix/docs/api/) — render from this model instead
of re-deriving everything from `dist/index.d.ts`, and cross-check the two against
each other: an `api.json` whose export list disagrees with the `.d.ts` it shipped
beside is exactly the drift this file exists to rule out.

## Schema (v1)

```jsonc
{
  "schema": 1,
  "package": "@boarteam/fix",
  "version": "0.5.0",
  "groups": [{ "id": "parse", "title": "Parsing", "symbols": ["parse", "…"] }],
  "symbols": [
    {
      "id": "parse", // the EXPORT name — the identity users type
      "kind": "function", // function | interface | type | class | const
      "signature": "function parse(raw: …): ParseResult", // verbatim .d.ts text
      "doc": "Parse one FIX message …", // RAW last JSDoc block, *-stripped
      "params": [{ "name": "raw", "type": "string | Uint8Array", "optional": false }],
      "returns": "ParseResult",
      "members": [
        // interfaces/classes: verbatim member text + raw doc
        { "name": "message", "kind": "property", "optional": false, "text": "…", "doc": "…" },
      ],
      "unionOf": ["…"], // string-literal unions as data (KnownIssueCode, Reqd, …)
      "source": { "path": "packages/fix/src/codec/parse.ts", "line": 88 },
      "since": "0.1.0", // first published version carrying this export name
    },
  ],
}
```

Facts a consumer may rely on:

- **`id` is the export name** and the stable identity. The rollup's declaration
  names (`Foo$1`) never appear.
- **`signature` and `members[].text` are the verbatim `dist/index.d.ts` text**
  (minus `declare `), never re-printed — what ships is what renders.
- **`doc` is raw TSDoc** (the last JSDoc block, `*`-stripped). The only tags
  present are `@param` / `@returns` / `@example`; any other tag fails the emit.
  Every `{@link}` target resolves (see the gates below) as an export name, an
  `Export.member` pair, a member/parameter of the enclosing declaration, or an
  allowlisted JavaScript global (`String.indexOf`).
- **`since`** is derived from the published npm artifacts (seeded 0.1.0 → 0.4.0
  from the real tarballs), keyed by export _name_ — a renamed export is a new
  name and gets the version the new name first shipped.
- The file is **deterministic**: no clock, no randomness; rebuilding the same
  commit yields the same bytes.

## The gates (fail the package build, therefore CI)

| Gate           | Fails when                                                                                                                                                                                                                              |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Doc coverage   | An exported symbol or an interface/class member has no doc comment. Parameter/`@returns` coverage is _reported_ (14/51 at introduction), not enforced yet.                                                                              |
| Link integrity | A `{@link}` target does not resolve, or uses a rollup path form (`./codec/…`).                                                                                                                                                          |
| Grouping       | An export is missing from `packages/fix/api/groups.json`, or listed twice. Placement is curation, not a heuristic.                                                                                                                      |
| Since          | An export has no `packages/fix/api/since.json` entry (`"next"` marks unreleased), or an entry names a non-export.                                                                                                                       |
| API diff       | The structural surface differs from `packages/fix/api/baseline.json` (the last published release) beyond what the version bump in `package.json` **or a pending changeset** allows: additions need ≥ minor, removals/alterations major. |

Doc-text-only changes pass at any level — prose is not surface. "Structural"
means: export list, kinds, signatures, parameter names/types/optionality,
returns, member list/text, and literal-union contents.

## Release-time maintenance

After each publish of `@boarteam/fix`, from the released commit:

```bash
pnpm --filter @boarteam/fix build
node packages/fix/scripts/refresh-api-baseline.mjs
```

This freezes `"next"` since-entries to the released version and makes the new
release the diff baseline. (Until it runs, the gate diffs against the previous
release with the version delta widening what is allowed — safe, just less
precise.) The published artifact itself is always correct without this step:
at publish time `package.json` already carries the new version, so `"next"`
resolves to it inside the emitted `api.json`.
