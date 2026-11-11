import { defineConfig } from '@rsbuild/core';
export default defineConfig({
  source: { entry: { index: './src/dashboard.ts' } },
  output: {
    distPath: { root: '../../dist/dashboard' },
    assetPrefix: './',
    cleanDistPath: true,
  },
  html: { title: 'Kypa policy scan' },
});
