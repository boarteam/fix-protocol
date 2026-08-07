---
'@boarteam/fix': minor
---

Ship `dist/api.json` — a machine-readable model of the public API — and gate the surface on it.

The tarball now carries the full API model beside the type declarations: every export with its
verbatim signature, raw doc comment, members, parameters, string-literal unions as data, source
position, and the version it first shipped in (seeded from the real 0.1.0–0.4.0 npm artifacts).
The emitter runs inside `pnpm build` and fails the package's own CI on an undocumented export or
member, an unresolvable `{@link}`, an export missing from the curated grouping or since-map, and
on any structural API change not covered by a changeset of the matching SemVer level.

Also closes the documentation backlog the model surfaced: the four options interfaces
(`ParseOptions`, `EncodeOptions`, `FrameOptions`, `TokenizeOptions`) and thirteen members are now
documented, and every rollup-path `{@link ./…}` target is rewritten to a resolvable name. Schema
and guarantees: `docs/api-json.md`.
