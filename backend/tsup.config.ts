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

  /**
   * Bundle the shared workspace package rather than resolving it at runtime.
   *
   * It compiles to ESM with extensionless relative imports ("./domain"), which
   * tsx resolves but plain node does not -- so the built server started fine in
   * development and died on boot in production with ERR_MODULE_NOT_FOUND.
   * It is our own source, not a third-party dependency, so it belongs inside
   * the bundle; that also means the deployed image no longer needs shared/dist
   * present at all.
   */
  noExternal: ["@study-loop/shared"],
});
