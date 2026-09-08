/**
 * Lakebase (Postgres) HTTP routes.
 *
 * Simple JSON polling endpoints — no SSE. The client refreshes on a short
 * interval (`useLakebaseTrades`), which is more reliable than long-lived
 * connections through the Databricks Apps proxy and matches the behaviour of
 * the reference Flask implementation.
 *
 * Endpoints:
 *   - GET /api/trades         — { trades: LiveTrade[], count: number }
 *   - GET /api/trades/latest  — LiveTrade | null   (single most-recent row)
 *   - GET /api/trades/count   — { count: number }
 *
 * All queries hit `public.trades_latest` (48 h rolling-window view mirroring
 * `dev_hysbox.telemetry.kr_intraday_public_trades_live_test`) on the AppKit
 * Lakebase pool. The pool refreshes its OAuth token automatically.
 */

import type { Application, Request, Response } from "express";
import type { LakebasePool } from "@databricks/appkit";

/** Default number of recent rows returned by `GET /api/trades`. */
const DEFAULT_RECENT_LIMIT = 10;

/** Absolute upper bound on `?limit=` to keep responses small. */
const MAX_RECENT_LIMIT = 100;

/**
 * Postgres schema that holds `trades_latest`. Sourced from the env so the same
 * bundle works against different Lakebase projects without a rebuild.
 *
 * Validated against a safe identifier pattern at startup so an env typo fails
 * loudly rather than silently producing a bad query.
 */
const SCHEMA = (() => {
  const raw = process.env.TELEMETRY_SCHEMA ?? "public";
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(raw)) {
    throw new Error(`TELEMETRY_SCHEMA is not a valid PostgreSQL identifier: "${raw}"`);
  }
  return raw;
})();

const COUNT_QUERY = `SELECT COUNT(*)::bigint AS count FROM ${SCHEMA}.trades_latest`;
const RECENT_QUERY = `
  SELECT *
  FROM ${SCHEMA}.trades_latest
  ORDER BY ingestion_timestamp DESC
  LIMIT $1
`;
const LATEST_QUERY = `
  SELECT *
  FROM ${SCHEMA}.trades_latest
  ORDER BY ingestion_timestamp DESC
  LIMIT 1
`;

/**
 * Parse the `?limit=` query parameter, clamped to [1, MAX_RECENT_LIMIT].
 * Falls back to DEFAULT_RECENT_LIMIT for missing / invalid values.
 */
function parseLimit(raw: unknown): number {
  if (typeof raw !== "string" || raw === "") return DEFAULT_RECENT_LIMIT;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_RECENT_LIMIT;
  return Math.min(n, MAX_RECENT_LIMIT);
}

/** node-postgres serialises bigint as string; coerce to a JS number. */
function toNumber(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return typeof value === "string" ? Number.parseInt(value, 10) : Number(value);
}

/**
 * Register all Lakebase routes on the Express app.
 *
 * Call from `onPluginsReady` after the lakebase plugin has initialised so the
 * pool is ready before the first request arrives.
 */
export function registerLakebaseRoutes(app: Application, pool: LakebasePool): void {
  // GET /api/trades — recent rows + total row count in one round-trip
  app.get("/api/trades", (req: Request, res: Response) => {
    void (async () => {
      try {
        const limit = parseLimit(req.query["limit"]);
        // Sequential rather than parallel: keeps each request to one pool
        // connection, avoiding pool exhaustion under moderate concurrency.
        const tradesRes = await pool.query<Record<string, unknown>>(RECENT_QUERY, [limit]);
        const countRes = await pool.query<{ count: string | number }>(COUNT_QUERY);
        res.json({
          trades: tradesRes.rows,
          count: toNumber(countRes.rows[0]?.count),
        });
      } catch (err) {
        console.error("[api/trades] query failed:", err);
        if (!res.headersSent) {
          res.status(500).json({ error: String(err) });
        }
      }
    })();
  });

  // GET /api/trades/latest — single most-recent row
  app.get("/api/trades/latest", (_req: Request, res: Response) => {
    void (async () => {
      try {
        const { rows } = await pool.query<Record<string, unknown>>(LATEST_QUERY);
        res.json(rows[0] ?? null);
      } catch (err) {
        console.error("[api/trades/latest] query failed:", err);
        if (!res.headersSent) {
          res.status(500).json({ error: String(err) });
        }
      }
    })();
  });

  // GET /api/trades/count — total row count
  app.get("/api/trades/count", (_req: Request, res: Response) => {
    void (async () => {
      try {
        const { rows } = await pool.query<{ count: string | number }>(COUNT_QUERY);
        res.json({ count: toNumber(rows[0]?.count) });
      } catch (err) {
        console.error("[api/trades/count] query failed:", err);
        if (!res.headersSent) {
          res.status(500).json({ error: String(err) });
        }
      }
    })();
  });

  console.log("[startup] Lakebase routes registered: /api/trades, /api/trades/latest, /api/trades/count");
}
