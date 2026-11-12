import { defineConfig } from "@rslib/core";

export default defineConfig({
  source: { entry: { index: "./src/main.ts" } },
  lib: [{ format: "esm", bundle: true, dts: false }],
  output: {
    target: "node",
    distPath: { root: "../../dist/cli" },
    cleanDistPath: true,
    autoExternal: false,
    externals: [],
  },
});
