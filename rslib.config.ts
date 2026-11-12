import { defineConfig } from "@rslib/core";

export default defineConfig({
  source: { entry: { index: "./packages/action/src/main.ts" } },
  lib: [{ format: "esm", bundle: true, dts: false }],
  output: { target: "node", distPath: { root: "dist/action" }, externals: [] },
});
