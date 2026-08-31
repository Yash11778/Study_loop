import { defineConfig } from "tsup";

/**
 * Bundling our own source (deps stay external) sidesteps the ESM extension
 * problem entirely: no ".js" suffixes on relative imports, and the "@/" alias
 * is resolved at build time rather than needing a runtime path loader.
 */
export default defineConfig({
  entry: ["src/server.ts"],
  format: ["esm"],
  target: "node22",
  outDir: "dist",
  sourcemap: true,
  clean: true,
  skipNodeModulesBundle: true,
});
