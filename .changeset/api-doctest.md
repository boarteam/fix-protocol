---
'@boarteam/fix': patch
---

Doctest the `@example` blocks and say so in the artifact.

Every `@example` in the public doc comments is now an executable claim: the blocks were
rewritten to be self-contained (real framed wire strings, `// →` output annotations) and
`examples/api-doctest.test.ts` runs each one verbatim with plain `node` against the built
workspace packages, asserting the stdout equals the annotations. The emit additionally
shape-gates every block (exactly one fence, at least one annotation), and `dist/api.json`
now carries `examplesVerified: true` — the render permission consumers key on before
showing examples. Additive field; schema stays 1.
