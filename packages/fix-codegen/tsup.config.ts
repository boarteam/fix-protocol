import { defineConfig } from 'tsup';

// Node-only build tool. We emit a single CJS bundle so `node dist/cli.cjs` runs without
// ESM extension/`__dirname` friction; the `import type` of the dictionary contract from
// `@boarteam/fix` is erased by esbuild, so nothing from that package is bundled in.
export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['cjs'],
  platform: 'node',
  target: 'node18',
  dts: false,
  sourcemap: false,
  clean: true,
});
