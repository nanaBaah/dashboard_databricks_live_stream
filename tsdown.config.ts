import path from "node:path";

import { defineConfig } from "tsdown";

const astGrepStub = path.resolve(process.cwd(), "src/server/ast_grep_stub.ts");

/**
 * Bundles the Express/AppKit server entry to `server_bundle/index.js` for
 * production (`npm run start` → `node server_bundle/index.js`).
 *
 * The server is bundled FULLY SELF-CONTAINED (`noExternal`) so the Databricks
 * Apps runtime needs no `npm install` at all — runtime `dependencies` in
 * package.json is empty. Only Node built-ins and the dev-only dynamic imports
 * (`vite`, `@vitejs/plugin-react`, loaded by AppKit's Vite dev server, which is
 * never used in production) stay external.
 *
 * `@ast-grep/napi` (a native addon AppKit only uses in its CLI, never at
 * runtime) is redirected to a stub via the resolve plugin below, so the bundle
 * carries no native `.node` binary and needs nothing installed.
 */
export default defineConfig({
  entry: ["src/server/index.ts"],
  outDir: "server_bundle",
  format: "esm",
  platform: "node",
  target: "node22",
  // Minify so the bundled server stays under the 10 MB per-file workspace limit
  // that Databricks Apps enforces when exporting the source.
  minify: true,
  noExternal: [/.*/],
  external: ["vite", "@vitejs/plugin-react"],
  plugins: [
    {
      name: "stub-ast-grep",
      resolveId(id: string) {
        if (id === "@ast-grep/napi") {
          return astGrepStub;
        }
        return null;
      },
    },
  ],
  outExtensions: () => ({ js: ".js" }),
});
