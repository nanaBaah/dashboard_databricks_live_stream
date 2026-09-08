/**
 * Delta / Unity Catalog aggregate queries — the history surface.
 *
 * Line-for-line the same shape as the Lakebase builders in `queries_pg.ts`, so
 * the two engines return identical columns and can be merged additively. Only
 * the dialect differs: named `:params` bound through the AppKit analytics
 * plugin, `SUBSTRING_INDEX`/`REGEXP_EXTRACT` for the derived country, and
 * `UNIX_TIMESTAMP` for the epoch-anchored bucket grid (the same grid Postgres
 * computes, so buckets line up exactly across the boundary).
 */

import { sql } from "@databricks/appkit";

import { UC_TABLE } from "../config.js";
import type { SqlParameter } from "../types.js";
import { MAX_PRODUCT_POINTS } from "./params.js";

/** A statement plus its bound parameters, ready for `analytics.query(...)`. */
export interface DeltaQuery {
  statement: string;
  parameters: Record<string, SqlParameter>;
}

type SqlParams = DeltaQuery["parameters"];

function literalInt(value: number, label: string): string {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer, got: ${String(value)}`);
  }
  return String(value);
}

/**
 * Mirrors the Databricks dataset's `country` field. `SUBSTRING_INDEX` takes the
 * first '|'-separated segment (the EIC market area) without the regex escaping
 * that `SPLIT(product_key, '\\|')[0]` needs, and is otherwise identical.
 */
const COUNTRY_EXPR = `
      CASE
        WHEN REGEXP_EXTRACT(SUBSTRING_INDEX(COALESCE(t.product_key, ''), '|', 1), '^10Y([A-Z]{2})', 1) <> ''
          THEN REGEXP_EXTRACT(SUBSTRING_INDEX(COALESCE(t.product_key, ''), '|', 1), '^10Y([A-Z]{2})', 1)
        WHEN REGEXP_EXTRACT(SUBSTRING_INDEX(COALESCE(t.product_key, ''), '|', 1), '^([A-Z]{2})-', 1) <> ''
          THEN REGEXP_EXTRACT(SUBSTRING_INDEX(COALESCE(t.product_key, ''), '|', 1), '^([A-Z]{2})-', 1)
        ELSE 'Other'
      END`;

const PRODUCT_TYPE_EXPR = `
      CASE
        WHEN t.delivery_start IS NULL OR t.delivery_end IS NULL THEN 'Unknown'
        ELSE CONCAT(CAST(TIMESTAMPDIFF(MINUTE, t.delivery_start, t.delivery_end) AS STRING), ' min')
      END`;

const BASE = `
    SELECT
      t.product_key,
      t.side,
      t.traded_ts,
      t.delivery_start,
      CAST(t.price_eur_mwh AS DOUBLE) AS price,
      CAST(t.volume_mw AS DOUBLE)     AS volume,${COUNTRY_EXPR} AS country,${PRODUCT_TYPE_EXPR} AS product_type
    FROM ${UC_TABLE} t
    WHERE t.traded_ts >= :fromTs AND t.traded_ts < :toTs`;

const FILTERS = `
    WHERE (:country = '' OR b.country = :country)
      AND (:productType = '' OR b.product_type = :productType)
      AND (:side = '' OR b.side = :side)`;

const AGGREGATES = `
      CAST(COUNT(*) AS DOUBLE)                            AS trades,
      CAST(COALESCE(SUM(b.volume), 0) AS DOUBLE)          AS volume,
      CAST(COALESCE(SUM(b.price * b.volume), 0) AS DOUBLE) AS pv,
      CAST(COALESCE(SUM(b.price), 0) AS DOUBLE)           AS price_sum,
      CAST(COUNT(b.price) AS DOUBLE)                      AS price_count,
      CAST(MIN(b.price) AS DOUBLE)                        AS min_price,
      CAST(MAX(b.price) AS DOUBLE)                        AS max_price`;

/** Same epoch-anchored grid as `queries_pg.ts`, so buckets align across sources. */
function bucketExpr(column: string, bucketSeconds: number): string {
  const width = literalInt(bucketSeconds, "bucketSeconds");
  return `CAST(FLOOR(UNIX_TIMESTAMP(${column}) / ${width}) * ${width} AS DOUBLE)`;
}

export interface DeltaQueryInput {
  from: Date;
  to: Date;
  country: string;
  productType: string;
  side: string;
  bucketSeconds: number;
}

function params(input: Omit<DeltaQueryInput, "bucketSeconds">): SqlParams {
  return {
    fromTs: sql.timestamp(input.from),
    toTs: sql.timestamp(input.to),
    country: sql.string(input.country),
    productType: sql.string(input.productType),
    side: sql.string(input.side),
  };
}

/** KPI row + volume-share donut. */
export function countryQuery(input: DeltaQueryInput): DeltaQuery {
  return {
    statement: `
  SELECT
      b.country AS country,${AGGREGATES}
  FROM (${BASE}
  ) b${FILTERS}
  GROUP BY b.country`,
    parameters: params(input),
  };
}

/** VWAP over traded time. */
export function tradedSeriesQuery(input: DeltaQueryInput): DeltaQuery {
  return {
    statement: `
  SELECT
      ${bucketExpr("b.traded_ts", input.bucketSeconds)} AS bucket,${AGGREGATES}
  FROM (${BASE}
  ) b${FILTERS}
  GROUP BY 1`,
    parameters: params(input),
  };
}

/** VWAP by delivery period and country; also folds up into the price envelope. */
export function deliverySeriesQuery(input: DeltaQueryInput): DeltaQuery {
  return {
    statement: `
  SELECT
      ${bucketExpr("b.delivery_start", input.bucketSeconds)} AS bucket,
      b.country AS country,${AGGREGATES}
  FROM (${BASE}
  ) b${FILTERS}
      AND b.delivery_start IS NOT NULL
  GROUP BY 1, 2`,
    parameters: params(input),
  };
}

/** Average price vs traded volume, one point per delivery contract and side. */
export function productsQuery(input: DeltaQueryInput): DeltaQuery {
  return {
    statement: `
  SELECT
      b.product_key  AS product_key,
      b.side         AS side,
      b.country      AS country,
      b.product_type AS product_type,${AGGREGATES}
  FROM (${BASE}
  ) b${FILTERS}
      AND b.product_key IS NOT NULL
  GROUP BY 1, 2, 3, 4
  ORDER BY SUM(b.volume) DESC
  LIMIT ${literalInt(MAX_PRODUCT_POINTS, "MAX_PRODUCT_POINTS")}`,
    parameters: params(input),
  };
}

/** Filter-dropdown options; only the traded time range applies. */
export function dimensionsQuery(input: Pick<DeltaQueryInput, "from" | "to">): DeltaQuery {
  return {
    statement: `
  SELECT
      b.country      AS country,
      b.product_type AS product_type,
      CAST(COUNT(*) AS DOUBLE)                   AS trades,
      CAST(COALESCE(SUM(b.volume), 0) AS DOUBLE) AS volume
  FROM (${BASE}
  ) b
  GROUP BY 1, 2`,
    parameters: { fromTs: sql.timestamp(input.from), toTs: sql.timestamp(input.to) },
  };
}

/** Freshness of the Delta history, for `/api/monitor/health`. */
export function freshnessQuery(): DeltaQuery {
  return {
    statement: `
  SELECT
      CAST(MAX(t.ingestion_timestamp) AS STRING) AS last_ingestion,
      CAST(UNIX_TIMESTAMP(CURRENT_TIMESTAMP()) - UNIX_TIMESTAMP(MAX(t.ingestion_timestamp)) AS DOUBLE) AS ingestion_age_seconds
  FROM ${UC_TABLE} t
  WHERE t.ingestion_timestamp > CURRENT_TIMESTAMP() - INTERVAL 2 HOURS`,
    parameters: {},
  };
}
