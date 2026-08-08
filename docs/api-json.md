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
  "examplesVerified": true, // every @example executed + output-asserted (≥ 0.5.1)
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
| Doctest        | An `@example` section is not exactly one annotated fence (emit), or the block fails to run / prints something other than its `// → ` annotations (`examples/api-doctest.test.ts`, `pnpm test`).                                         |

Doc-text-only changes pass at any level — prose is not surface. "Structural"
means: export list, kinds, signatures, parameter names/types/optionality,
returns, member list/text, and literal-union contents.

## The `@example` doctest (`examplesVerified`)

`@example` blocks are executable claims, held by two gates:

- **Shape, at emit:** each `@example` section is exactly one fenced code block
  carrying at least one `// → ` output annotation — an example that asserts
  nothing proves nothing. (Only the line annotation form exists here; a
  `/* → */` block would close the enclosing JSDoc comment.)
- **Execution, in CI:** `examples/api-doctest.test.ts` runs every block
  verbatim with plain `node` from `examples/` (the workspace links make
  `import '@boarteam/fix'` resolve like a consumer's install) and asserts the
  stdout equals the annotations line for line.

Authoring rules that follow: blocks are runnable ESM **JavaScript** (node
executes them un-transpiled — type annotations don't run), self-contained
(declare your own wire strings; encode them to get correct framing), and
deterministic (no clocks, no randomness). Prose comments inside a block must
not begin with `// → ` — that prefix is reserved for asserted output.

`examplesVerified: true` in the artifact is the render permission consumers
key on: boar.team withholds example rendering from any version that does not
carry it. The claim's chain of trust is the repo's CI — the doctest gates
every PR into `main`, and releases build from `main`.

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
