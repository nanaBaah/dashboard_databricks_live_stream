/**
 * Shared server configuration for the two trade surfaces.
 *
 * The dashboard reads the SAME logical table from two engines:
 *
 *   - Lakebase Postgres `<schema>.<table>` — a bounded 48 h FIFO hot buffer
 *     (Story 2.4). Sub-second reads; this is the live surface.
 *   - Delta / Unity Catalog `<catalog>.<schema>.<table>` via a Serverless SQL
 *     Warehouse — the complete, append-only history. Slower, unbounded.
 *
 * Every value is env-overridable so one bundle works against dev/prod without
 * a rebuild, and every identifier is validated at startup: an env typo fails
 * loudly at boot rather than silently producing a broken query (identifiers
 * cannot be bound as SQL parameters, so they are interpolated).
 */

/** Parse a positive number from the environment, falling back on absence/garbage. */
function envNumber(name: string, fallback: number, { min, max }: { min: number; max: number }): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new Error(`${name} must be a number in [${min}, ${max}], got: "${raw}"`);
  }
  return n;
}

/**
 * Postgres schema holding the live buffer table.
 * Validated against a safe identifier pattern (interpolated, not bound).
 */
export const LAKEBASE_SCHEMA = (() => {
  const raw = process.env.TELEMETRY_SCHEMA ?? "public";
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(raw)) {
    throw new Error(`TELEMETRY_SCHEMA is not a valid PostgreSQL identifier: "${raw}"`);
  }
  return raw;
})();

/** Postgres table holding the live 48 h buffer. */
export const LAKEBASE_TABLE = (() => {
  const raw = process.env.LAKEBASE_TABLE ?? "trades_latest";
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(raw)) {
    throw new Error(`LAKEBASE_TABLE is not a valid PostgreSQL identifier: "${raw}"`);
  }
  return raw;
})();

/** `schema.table` for the live surface, ready to interpolate into SQL. */
export const LAKEBASE_FQN = `${LAKEBASE_SCHEMA}.${LAKEBASE_TABLE}`;

/** Fully-qualified Unity Catalog table holding the unbounded history. */
export const UC_TABLE = (() => {
  const raw = process.env.UC_TABLE ?? "dev_hysbox.telemetry.kr_intraday_public_trades_live_test";
  if (!/^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*){0,2}$/i.test(raw)) {
    throw new Error(`UC_TABLE is not a valid Unity Catalog identifier: "${raw}"`);
  }
  return raw;
})();

/**
 * Size of the Lakebase FIFO buffer, in hours (Story 2.4 evicts on
 * `ingestion_timestamp < now() - INTERVAL '<this> hours'`).
 */
export const BUFFER_HOURS = envNumber("LAKEBASE_BUFFER_HOURS", 48, { min: 1, max: 720 });

/**
 * Safety margin pulled off the buffer edge before routing a query to Lakebase.
 *
 * Eviction keys on `ingestion_timestamp` while the dashboard filters on
 * `traded_ts`, and a trade is always ingested at or after it was executed
 * (`ingestion_timestamp >= traded_ts`). So a row with
 * `traded_ts >= now - (BUFFER_HOURS - margin)` cannot yet have been evicted —
 * the margin absorbs eviction-schedule jitter and clock skew, and anything
 * older is served from Delta, which holds it regardless.
 */
export const BUFFER_SAFETY_MINUTES = envNumber("LAKEBASE_BUFFER_SAFETY_MINUTES", 60, {
  min: 0,
  max: 24 * 60,
});

/** Freshness thresholds for `/api/monitor/health` (Story 4.4), in seconds. */
export const FRESHNESS_LAGGING_SECONDS = envNumber("FRESHNESS_LAGGING_SECONDS", 30, { min: 1, max: 86_400 });
export const FRESHNESS_STALE_SECONDS = envNumber("FRESHNESS_STALE_SECONDS", 120, { min: 1, max: 86_400 });

/** Widest traded-time range the dashboard will query, in days. */
export const MAX_RANGE_DAYS = envNumber("MONITOR_MAX_RANGE_DAYS", 90, { min: 1, max: 3650 });

/** Statement timeout applied to Lakebase aggregate queries, in milliseconds. */
export const LAKEBASE_STATEMENT_TIMEOUT_MS = envNumber("LAKEBASE_STATEMENT_TIMEOUT_MS", 20_000, {
  min: 1_000,
  max: 300_000,
});

/** Abort a Delta/warehouse statement after this long, in milliseconds. */
export const DELTA_STATEMENT_TIMEOUT_MS = envNumber("DELTA_STATEMENT_TIMEOUT_MS", 120_000, {
  min: 5_000,
  max: 600_000,
});
