/**
 * Executes one planner window against one engine and normalises the result.
 *
 * The two engines are deliberately symmetrical: same panel set, same column
 * names, same bucket grid — so the caller can merge them without knowing which
 * one produced a row. Everything engine-specific stops here.
 */

import type { LakebasePool } from "@databricks/appkit";

import { DELTA_STATEMENT_TIMEOUT_MS, LAKEBASE_STATEMENT_TIMEOUT_MS } from "../config.js";
import type { AnalyticsExecutor, AnalyticsResult, AnalyticsRow } from "../types.js";
import { toNullableNumber, toNumber } from "./aggregate.js";
import * as delta from "./queries_delta.js";
import type { MonitorFilters } from "./params.js";
import type { SourceName, SourceWindow } from "./plan.js";
import * as pg from "./queries_pg.js";
import type {
  AggColumns,
  CountryRow,
  DeliveryBucketRow,
  DimensionRow,
  ProductRow,
  TradedBucketRow,
} from "./types.js";

/** The four panel datasets one source contributes to an overview response. */
export interface PanelRows {
  country: CountryRow[];
  tradedSeries: TradedBucketRow[];
  deliverySeries: DeliveryBucketRow[];
  products: ProductRow[];
}

/** What each source did, surfaced to the client so the routing stays visible. */
export interface SourceStats {
  source: SourceName;
  /** Human label for the engine behind this window. */
  engine: string;
  from: string;
  to: string;
  /** Wall-clock duration of the window's queries, in milliseconds. */
  durationMs: number;
  rows: number;
  /** Non-null when this window failed; its data is missing from the response. */
  error: string | null;
}

export interface SourceDeps {
  pool: LakebasePool;
  analytics: AnalyticsExecutor;
}

const ENGINE_LABEL: Record<SourceName, string> = {
  lakebase: "Lakebase Postgres",
  delta: "Delta · SQL Warehouse",
};

function emptyPanels(): PanelRows {
  return { country: [], tradedSeries: [], deliverySeries: [], products: [] };
}

function countRows(panels: PanelRows): number {
  return (
    panels.country.length + panels.tradedSeries.length + panels.deliverySeries.length + panels.products.length
  );
}

/** Coerce the shared aggregate columns of a raw row from either engine. */
function aggColumns(row: Record<string, unknown>): AggColumns {
  return {
    trades: toNumber(row["trades"]),
    volume: toNumber(row["volume"]),
    pv: toNumber(row["pv"]),
    price_sum: toNumber(row["price_sum"]),
    price_count: toNumber(row["price_count"]),
    min_price: toNullableNumber(row["min_price"]),
    max_price: toNullableNumber(row["max_price"]),
  };
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" && value !== "" ? value : fallback;
}

function toCountryRow(row: Record<string, unknown>): CountryRow {
  return { country: text(row["country"], "Other"), ...aggColumns(row) };
}

function toTradedBucketRow(row: Record<string, unknown>): TradedBucketRow {
  return { bucket: toNumber(row["bucket"]), ...aggColumns(row) };
}

function toDeliveryBucketRow(row: Record<string, unknown>): DeliveryBucketRow {
  return { bucket: toNumber(row["bucket"]), country: text(row["country"], "Other"), ...aggColumns(row) };
}

function toProductRow(row: Record<string, unknown>): ProductRow {
  return {
    product_key: text(row["product_key"]),
    side: typeof row["side"] === "string" ? row["side"] : null,
    country: text(row["country"], "Other"),
    product_type: text(row["product_type"], "Unknown"),
    ...aggColumns(row),
  };
}

function toDimensionRow(row: Record<string, unknown>): DimensionRow {
  return {
    country: text(row["country"], "Other"),
    product_type: text(row["product_type"], "Unknown"),
    trades: toNumber(row["trades"]),
    volume: toNumber(row["volume"]),
  };
}

/**
 * Run `fn` inside a read-only transaction with a statement timeout.
 *
 * Beyond bounding a runaway scan, the transaction gives every panel query in a
 * window the same snapshot — so the KPI row can never disagree with the charts
 * because a trade landed between two statements.
 */
async function withReadOnlySnapshot<T>(
  pool: LakebasePool,
  fn: (run: (query: pg.PgQuery) => Promise<Array<Record<string, unknown>>>) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN TRANSACTION READ ONLY");
    await client.query(`SET LOCAL statement_timeout = ${Math.round(LAKEBASE_STATEMENT_TIMEOUT_MS)}`);
    const result = await fn(async (query) => {
      const { rows } = await client.query<Record<string, unknown>>(query.text, query.values);
      return rows;
    });
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** Unwrap the analytics executor's `{ data: [...] }` envelope. */
function analyticsRows(result: unknown): AnalyticsRow[] {
  const data = (result as AnalyticsResult | null)?.data;
  return Array.isArray(data) ? data : [];
}

async function runDelta(
  analytics: AnalyticsExecutor,
  query: delta.DeltaQuery,
  signal: AbortSignal,
): Promise<AnalyticsRow[]> {
  return analyticsRows(await analytics.query(query.statement, query.parameters, undefined, signal));
}

/** Run the four overview panels for one window, on the engine the plan chose. */
export async function fetchOverviewWindow(
  deps: SourceDeps,
  window: SourceWindow,
  filters: MonitorFilters,
): Promise<{ panels: PanelRows; stats: SourceStats }> {
  const started = Date.now();
  const input = {
    from: window.from,
    to: window.to,
    country: filters.country,
    productType: filters.productType,
    side: filters.side,
    bucketSeconds: filters.bucketSeconds,
  };

  const stats: SourceStats = {
    source: window.source,
    engine: ENGINE_LABEL[window.source],
    from: window.from.toISOString(),
    to: window.to.toISOString(),
    durationMs: 0,
    rows: 0,
    error: null,
  };

  try {
    let panels: PanelRows;

    if (window.source === "lakebase") {
      // Sequential on one connection: four short aggregate scans against a
      // 48 h buffer, and one checkout per request keeps the pool free under
      // concurrent viewers.
      panels = await withReadOnlySnapshot(deps.pool, async (run) => ({
        country: (await run(pg.countryQuery(input))).map(toCountryRow),
        tradedSeries: (await run(pg.tradedSeriesQuery(input))).map(toTradedBucketRow),
        deliverySeries: (await run(pg.deliverySeriesQuery(input))).map(toDeliveryBucketRow),
        products: (await run(pg.productsQuery(input))).map(toProductRow),
      }));
    } else {
      // Parallel on the warehouse: each statement is slow and independent, and
      // the warehouse is sized for concurrency.
      const signal = AbortSignal.timeout(DELTA_STATEMENT_TIMEOUT_MS);
      const [country, tradedSeries, deliverySeries, products] = await Promise.all([
        runDelta(deps.analytics, delta.countryQuery(input), signal),
        runDelta(deps.analytics, delta.tradedSeriesQuery(input), signal),
        runDelta(deps.analytics, delta.deliverySeriesQuery(input), signal),
        runDelta(deps.analytics, delta.productsQuery(input), signal),
      ]);
      panels = {
        country: country.map(toCountryRow),
        tradedSeries: tradedSeries.map(toTradedBucketRow),
        deliverySeries: deliverySeries.map(toDeliveryBucketRow),
        products: products.map(toProductRow),
      };
    }

    stats.durationMs = Date.now() - started;
    stats.rows = countRows(panels);
    return { panels, stats };
  } catch (err) {
    stats.durationMs = Date.now() - started;
    stats.error = err instanceof Error ? err.message : String(err);
    console.error(`[monitor] ${window.source} window failed:`, err);
    return { panels: emptyPanels(), stats };
  }
}

/** Run the dimension (filter-option) query for one window. */
export async function fetchDimensionsWindow(
  deps: SourceDeps,
  window: SourceWindow,
): Promise<{ rows: DimensionRow[]; stats: SourceStats }> {
  const started = Date.now();
  const stats: SourceStats = {
    source: window.source,
    engine: ENGINE_LABEL[window.source],
    from: window.from.toISOString(),
    to: window.to.toISOString(),
    durationMs: 0,
    rows: 0,
    error: null,
  };

  try {
    const rows =
      window.source === "lakebase"
        ? (await withReadOnlySnapshot(deps.pool, (run) => run(pg.dimensionsQuery(window)))).map(toDimensionRow)
        : (
            await runDelta(
              deps.analytics,
              delta.dimensionsQuery(window),
              AbortSignal.timeout(DELTA_STATEMENT_TIMEOUT_MS),
            )
          ).map(toDimensionRow);

    stats.durationMs = Date.now() - started;
    stats.rows = rows.length;
    return { rows, stats };
  } catch (err) {
    stats.durationMs = Date.now() - started;
    stats.error = err instanceof Error ? err.message : String(err);
    console.error(`[monitor] ${window.source} dimensions failed:`, err);
    return { rows: [], stats };
  }
}

/** Raw freshness numbers from the live buffer. */
export interface LakebaseFreshness {
  lastIngestion: string | null;
  lastTraded: string | null;
  ingestionAgeSeconds: number | null;
  tradedAgeSeconds: number | null;
  rows1m: number;
  rows5m: number;
  rows1h: number;
}

export async function fetchLakebaseFreshness(pool: LakebasePool): Promise<LakebaseFreshness> {
  const rows = await withReadOnlySnapshot(pool, (run) => run(pg.freshnessQuery()));
  const row = rows[0] ?? {};
  const asIso = (value: unknown): string | null =>
    value instanceof Date ? value.toISOString() : typeof value === "string" ? value : null;
  return {
    lastIngestion: asIso(row["last_ingestion"]),
    lastTraded: asIso(row["last_traded"]),
    ingestionAgeSeconds: toNullableNumber(row["ingestion_age_seconds"]),
    tradedAgeSeconds: toNullableNumber(row["traded_age_seconds"]),
    rows1m: toNumber(row["rows_1m"]),
    rows5m: toNumber(row["rows_5m"]),
    rows1h: toNumber(row["rows_1h"]),
  };
}

export async function fetchDeltaFreshness(
  analytics: AnalyticsExecutor,
): Promise<{ lastIngestion: string | null; ageSeconds: number | null }> {
  const rows = await runDelta(analytics, delta.freshnessQuery(), AbortSignal.timeout(DELTA_STATEMENT_TIMEOUT_MS));
  const row = rows[0] ?? {};
  return {
    lastIngestion: typeof row["last_ingestion"] === "string" ? row["last_ingestion"] : null,
    ageSeconds: toNullableNumber(row["ingestion_age_seconds"]),
  };
}
