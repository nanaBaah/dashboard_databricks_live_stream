/**
 * Minimal structural types for the AppKit plugin surfaces the routes use, so
 * route modules don't take a hard dependency on AppKit's internal generics.
 */

import type { sql } from "@databricks/appkit";

/**
 * A typed SQL parameter marker produced by AppKit's `sql.*` helpers.
 *
 * AppKit does not re-export the marker union from its package root, so it is
 * reconstructed from the helper return types: that keeps this structurally
 * identical to `SQLTypeMarker`, so `appKit.analytics` still satisfies
 * `AnalyticsExecutor` below.
 */
export type SqlParameter =
  | ReturnType<typeof sql.string>
  | ReturnType<typeof sql.number>
  | ReturnType<typeof sql.boolean>
  | ReturnType<typeof sql.date>
  | ReturnType<typeof sql.timestamp>;

/** A single row from the analytics executor; the Statement API returns strings. */
export type AnalyticsRow = Record<string, unknown>;

/** Shape of the `.result` object returned by `appKit.analytics.query(...)`. */
export interface AnalyticsResult {
  data?: AnalyticsRow[];
}

/** The `query` export of the AppKit `analytics` plugin. */
export interface AnalyticsExecutor {
  query: (
    query: string,
    parameters?: Record<string, SqlParameter>,
    formatParameters?: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<unknown>;
}
