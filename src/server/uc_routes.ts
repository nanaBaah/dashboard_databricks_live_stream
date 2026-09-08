/**
 * Unity Catalog (SQL Warehouse) HTTP routes.
 *
 * Runs the same queries as the Flask reference (`ANALYTICS_QUERIES`) against
 * the UC table `dev_hysbox.telemetry.kr_intraday_public_trades_live_test`
 * through the AppKit `analytics` plugin's server-side executor
 * (`appKit.analytics.query`). Returns plain JSON — no SSE.
 *
 * Endpoints:
 *   - GET /api/uc/latest — most-recent row (or null)
 *   - GET /api/uc/count  — { count: number }
 *
 * The queries are also present as file-based analytics queries in
 * `config/queries/testtable*.sql`; we duplicate them here as string literals
 * so the client never has to open an SSE connection.
 */

import type { Application, Request, Response } from "express";

/**
 * Minimal interface for the analytics executor exposed by the AppKit
 * `analytics` plugin (`appKit.analytics.query(...)`). Typed here so we don't
 * take a hard dependency on internal AppKit generics.
 */
interface AnalyticsExecutor {
  query: (sql: string) => Promise<unknown>;
}

/**
 * Fully-qualified UC table name. Configurable so the same bundle works
 * against dev/prod catalogs, and validated to prevent SQL injection since
 * we interpolate it directly into the query text.
 */
const UC_TABLE = (() => {
  const raw = process.env.UC_TABLE ?? "dev_hysbox.telemetry.kr_intraday_public_trades_live_test";
  if (!/^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*){0,2}$/i.test(raw)) {
    throw new Error(`UC_TABLE is not a valid Unity Catalog identifier: "${raw}"`);
  }
  return raw;
})();

const LATEST_UC_QUERY = `
  SELECT
    trade_id, product_key, source, eic, side,
    price_eur_mwh, volume_mw, currency, aggressor,
    self_trade, company_trade, traded_ts, delivery_start,
    delivery_end, delivery_hour, trade_date, ingestion_timestamp,
    kafka_partition, kafka_offset, kafka_timestamp
  FROM ${UC_TABLE}
  ORDER BY ingestion_timestamp DESC
  LIMIT 1
`;

const COUNT_UC_QUERY = `SELECT COUNT(*) AS count FROM ${UC_TABLE}`;

/** Shape of a single row returned by AppKit's analytics executor. */
interface AnalyticsRow {
  [column: string]: unknown;
}

/** Shape of the `.result` object returned by `appKit.analytics.query(...)`. */
interface AnalyticsResult {
  data?: AnalyticsRow[];
}

/**
 * Register the UC routes on the Express app.
 *
 * Call from `onPluginsReady` after the analytics plugin has initialised.
 */
export function registerUcRoutes(app: Application, analytics: AnalyticsExecutor): void {
  app.get("/api/uc/latest", (_req: Request, res: Response) => {
    void (async () => {
      try {
        const result = (await analytics.query(LATEST_UC_QUERY)) as AnalyticsResult | null;
        const row = result?.data?.[0] ?? null;
        res.json(row);
      } catch (err) {
        console.error("[api/uc/latest] query failed:", err);
        if (!res.headersSent) {
          res.status(500).json({ error: String(err) });
        }
      }
    })();
  });

  app.get("/api/uc/count", (_req: Request, res: Response) => {
    void (async () => {
      try {
        const result = (await analytics.query(COUNT_UC_QUERY)) as AnalyticsResult | null;
        const raw = result?.data?.[0]?.["count"];
        const count = typeof raw === "string" ? Number.parseInt(raw, 10) : Number(raw ?? 0);
        res.json({ count: Number.isFinite(count) ? count : 0 });
      } catch (err) {
        console.error("[api/uc/count] query failed:", err);
        if (!res.headersSent) {
          res.status(500).json({ error: String(err) });
        }
      }
    })();
  });

  console.log("[startup] UC routes registered: /api/uc/latest, /api/uc/count");
}

/** Exposed so the client can render the table name in the UI. */
export const UC_TABLE_NAME = UC_TABLE;
