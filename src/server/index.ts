/**
 * Telemetry Dashboard — AppKit server entry point.
 *
 * Plugins:
 *   - `server`    — Express HTTP server + static client bundle.
 *   - `analytics` — Serverless SQL Warehouse reads (used server-side via
 *                   `appKit.analytics.query(...)`; the client never opens
 *                   an SSE analytics connection).
 *   - `lakebase`  — pg.Pool → Lakebase Autoscaling (OAuth auto-refresh).
 *
 * Custom routes registered in `onPluginsReady` (after all plugins initialise):
 *   - GET /api/monitor/overview   — every dashboard panel for one filter set,
 *                                   routed across the Lakebase/Delta boundary
 *   - GET /api/monitor/dimensions — filter-dropdown options for a traded range
 *   - GET /api/monitor/health     — pipeline freshness for the header dot
 *   - GET /api/trades[…]          — raw Lakebase rows (diagnostics panel)
 *   - GET /api/uc/[…]             — raw UC rows via SQL Warehouse (diagnostics)
 *
 * The React client polls these endpoints on a short interval (see
 * `src/client/monitor/useMonitor.ts`). Long-lived SSE connections were removed
 * because they proved unreliable through the Databricks Apps proxy and the
 * Lakebase Autoscaling cold-start path.
 *
 * Docs:
 *   - Apps overview:          https://developers.databricks.com/docs/apps/overview
 *   - Analytical reads:       https://developers.databricks.com/docs/lakehouse/analytical-reads
 *   - Analytics plugin:       https://developers.databricks.com/docs/appkit/v0/plugins/analytics
 *   - Lakebase plugin:        https://developers.databricks.com/docs/appkit/v0/plugins/lakebase
 */
import { analytics, createApp, lakebase, server } from "@databricks/appkit";

import { registerLakebaseRoutes } from "./lakebase_routes.js";
import { registerMonitorRoutes } from "./monitor/routes.js";
import { registerUcRoutes } from "./uc_routes.js";

console.log("[startup] env:", {
  DATABRICKS_WAREHOUSE_ID: !!process.env.DATABRICKS_WAREHOUSE_ID,
  LAKEBASE_ENDPOINT: !!process.env.LAKEBASE_ENDPOINT,
  DATABRICKS_HOST: !!process.env.DATABRICKS_HOST,
  NODE_ENV: process.env.NODE_ENV,
  PORT: process.env.PORT ?? process.env.DATABRICKS_APP_PORT,
});

// Defense-in-depth: keep the app alive even if a single query throws.
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection (ignored to keep app alive):", reason);
});
process.on("uncaughtException", (error) => {
  console.error("Uncaught exception (ignored to keep app alive):", error);
});
process.on("exit", (code) => {
  console.log(`[shutdown] process exiting with code ${code}`);
});

await createApp({
  plugins: [
    server({ staticPath: "client_bundle" }),
    // autoStartWarehouse: true wakes the Serverless warehouse on the first
    // request so users don't see a stall on cold start.
    analytics({ autoStartWarehouse: true }),
    // Lakebase pool — pg.Pool backed by OAuth token auto-refresh.
    // PGHOST / PGDATABASE / PGSSLMODE are injected by the Apps platform from
    // the `postgres` resource; LAKEBASE_ENDPOINT is set explicitly in app.yaml.
    //
    // Pool sizing for a short-poll pattern (2 s poll, short-lived checkouts):
    // 5 connections handles a handful of concurrent clients with headroom for
    // one-off queries. connectionTimeoutMillis covers the Lakebase Autoscaling
    // cold-start wake-up (a few seconds after idle).
    lakebase({
      pool: {
        max: 5,
        connectionTimeoutMillis: 15_000, // wait up to 15 s for cold-start wake-up
        idleTimeoutMillis: 30_000,       // release idle connections after 30 s
      },
    }),
  ],
  onPluginsReady(appKit) {
    // Register the polling routes after both plugins have initialised.
    appKit.server.extend((app) => {
      // appKit.lakebase.pool is the AppKit-instrumented pg.Pool — OTel hooks
      // for query duration, pool connections, and token refresh are set up on
      // the pool by the lakebase plugin at initialisation time.
      registerLakebaseRoutes(app, appKit.lakebase.pool);
      // appKit.analytics.query executes SQL against the Serverless SQL
      // Warehouse using the service principal's credentials (no SSE).
      registerUcRoutes(app, appKit.analytics);
      // The dashboard routes need both surfaces: the planner picks Lakebase,
      // the warehouse, or both, from the requested traded time range.
      registerMonitorRoutes(app, { pool: appKit.lakebase.pool, analytics: appKit.analytics });
    });
  },
});

console.log("Intraday Public Trades — Live Monitor started (polling mode; no SSE).");
