import { defineConfig } from '@rslib/core';

export default defineConfig({
  source: { entry: { index: './packages/sdk/src/index.ts' } },
  lib: [{ format: 'esm', bundle: true, dts: false }],
  output: { target: 'node', distPath: { root: 'dist/sdk' }, externals: [] },
});
