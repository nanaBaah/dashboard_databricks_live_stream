/**
 * Build-time stub for `@ast-grep/napi`.
 *
 * `@ast-grep/napi` is a native (`.node`) addon that AppKit imports **only** in
 * its CLI tooling (`appkit lint`, `appkit plugin sync`, `appkit codemod` — see
 * packages/shared/src/cli/). The runtime server (createApp + server/lakebase/
 * analytics plugins) never calls it. It only ends up in the bundle because it's
 * statically reachable in the import graph.
 *
 * Native addons can't be bundled, and the Databricks Apps runtime on this
 * workspace can't `npm install` it either. tsdown aliases `@ast-grep/napi` to
 * this stub (see tsdown.config.ts) so the server bundle is fully self-contained
 * — no native binary, no npm install. The exports below satisfy the static
 * imports; they throw only if actually invoked (which never happens at runtime).
 */

/** Placeholder for the `Lang` enum (never read at runtime). */
export const Lang: Record<string, string> = new Proxy(
  {},
  { get: (_target, prop): string => String(prop) },
) as Record<string, string>;

/** Placeholder for `parse` (never called at runtime). */
export function parse(): never {
  throw new Error(
    "@ast-grep/napi is stubbed in this build: it is only used by AppKit CLI tooling, not the runtime server.",
  );
}
