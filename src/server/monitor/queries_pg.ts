/**
 * Lakebase (PostgreSQL) aggregate queries — the live surface.
 *
 * Every query is the same shape: a derived table that projects the dashboard's
 * computed dimensions, then a GROUP BY that emits only additive partials.
 * Filters bind as `$3..$5` with `''` meaning "no filter"; bucket widths and
 * row limits are validated numeric literals (they cannot be bound in the
 * positions they occupy without defeating the planner).
 *
 * The derived dimensions mirror the Databricks dataset one-for-one:
 *   country      SPLIT(product_key,'|')[0] -> '^10Y(XX)' then '^(XX)-' else 'Other'
 *   product_type delivery span in whole minutes, e.g. '15 min'
 */

import { LAKEBASE_FQN } from "../config.js";
import { MAX_PRODUCT_POINTS } from "./params.js";

export interface PgQuery {
  text: string;
  values: unknown[];
}

/** Guard for the few numbers interpolated as SQL literals. */
function literalInt(value: number, label: string): string {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer, got: ${String(value)}`);
  }
  return String(value);
}

/**
 * `country`: first '|'-separated segment of product_key is the EIC market area.
 * `substring(... from pattern)` returns the first capture group, or NULL when
 * the pattern does not match — so the COALESCE chain is exactly the dataset's
 * CASE/REGEXP_EXTRACT ladder.
 */
const COUNTRY_EXPR = `
      COALESCE(
        substring(split_part(COALESCE(t.product_key, ''), '|', 1) FROM '^10Y([A-Z]{2})'),
        substring(split_part(COALESCE(t.product_key, ''), '|', 1) FROM '^([A-Z]{2})-'),
        'Other'
      )`;

const PRODUCT_TYPE_EXPR = `
      CASE
        WHEN t.delivery_start IS NULL OR t.delivery_end IS NULL THEN 'Unknown'
        ELSE ROUND(EXTRACT(EPOCH FROM (t.delivery_end - t.delivery_start)) / 60)::bigint || ' min'
      END`;

/** The projected row set every panel query groups over. `$1`/`$2` bound the range. */
const BASE = `
    SELECT
      t.product_key,
      t.side,
      t.traded_ts,
      t.delivery_start,
      t.price_eur_mwh::double precision AS price,
      t.volume_mw::double precision     AS volume,${COUNTRY_EXPR} AS country,${PRODUCT_TYPE_EXPR} AS product_type
    FROM ${LAKEBASE_FQN} t
    WHERE t.traded_ts >= $1 AND t.traded_ts < $2`;

/** Filter predicate over the derived dimensions; `''` disables a filter. */
const FILTERS = `
    WHERE ($3::text = '' OR b.country = $3::text)
      AND ($4::text = '' OR b.product_type = $4::text)
      AND ($5::text = '' OR b.side = $5::text)`;

/** The additive partials — never a ratio. See `types.ts`. */
const AGGREGATES = `
      COUNT(*)::double precision                     AS trades,
      COALESCE(SUM(b.volume), 0)::double precision   AS volume,
      COALESCE(SUM(b.price * b.volume), 0)::double precision AS pv,
      COALESCE(SUM(b.price), 0)::double precision    AS price_sum,
      COUNT(b.price)::double precision               AS price_count,
      MIN(b.price)::double precision                 AS min_price,
      MAX(b.price)::double precision                 AS max_price`;

/** Floor a timestamp column onto an epoch-anchored bucket grid, as epoch seconds. */
function bucketExpr(column: string, bucketSeconds: number): string {
  const width = literalInt(bucketSeconds, "bucketSeconds");
  return `(FLOOR(EXTRACT(EPOCH FROM ${column}) / ${width}) * ${width})::double precision`;
}

function values(from: Date, to: Date, country: string, productType: string, side: string): unknown[] {
  return [from.toISOString(), to.toISOString(), country, productType, side];
}

export interface PgQueryInput {
  from: Date;
  to: Date;
  country: string;
  productType: string;
  side: string;
  bucketSeconds: number;
}

/** KPI row + volume-share donut. */
export function countryQuery(input: PgQueryInput): PgQuery {
  return {
    text: `
  SELECT
      b.country AS country,${AGGREGATES}
  FROM (${BASE}
  ) b${FILTERS}
  GROUP BY b.country`,
    values: values(input.from, input.to, input.country, input.productType, input.side),
  };
}

/** VWAP over traded time. */
export function tradedSeriesQuery(input: PgQueryInput): PgQuery {
  return {
    text: `
  SELECT
      ${bucketExpr("b.traded_ts", input.bucketSeconds)} AS bucket,${AGGREGATES}
  FROM (${BASE}
  ) b${FILTERS}
  GROUP BY 1`,
    values: values(input.from, input.to, input.country, input.productType, input.side),
  };
}

/**
 * VWAP by delivery period, split by country. Aggregating this result over the
 * country axis also yields the min/VWAP/max price envelope, so both
 * delivery-axis panels come from one query.
 */
export function deliverySeriesQuery(input: PgQueryInput): PgQuery {
  return {
    text: `
  SELECT
      ${bucketExpr("b.delivery_start", input.bucketSeconds)} AS bucket,
      b.country AS country,${AGGREGATES}
  FROM (${BASE}
  ) b${FILTERS}
      AND b.delivery_start IS NOT NULL
  GROUP BY 1, 2`,
    values: values(input.from, input.to, input.country, input.productType, input.side),
  };
}

/** Average price vs traded volume, one point per delivery contract and side. */
export function productsQuery(input: PgQueryInput): PgQuery {
  return {
    text: `
  SELECT
      b.product_key AS product_key,
      b.side        AS side,
      b.country     AS country,
      b.product_type AS product_type,${AGGREGATES}
  FROM (${BASE}
  ) b${FILTERS}
      AND b.product_key IS NOT NULL
  GROUP BY 1, 2, 3, 4
  ORDER BY SUM(b.volume) DESC NULLS LAST
  LIMIT ${literalInt(MAX_PRODUCT_POINTS, "MAX_PRODUCT_POINTS")}`,
    values: values(input.from, input.to, input.country, input.productType, input.side),
  };
}

/**
 * Filter-dropdown options. Deliberately ignores the dimension filters (only the
 * traded time range applies) so selecting a country never empties the list.
 */
export function dimensionsQuery(input: Pick<PgQueryInput, "from" | "to">): PgQuery {
  return {
    text: `
  SELECT
      b.country      AS country,
      b.product_type AS product_type,
      COUNT(*)::double precision                   AS trades,
      COALESCE(SUM(b.volume), 0)::double precision AS volume
  FROM (${BASE}
  ) b
  GROUP BY 1, 2`,
    values: [input.from.toISOString(), input.to.toISOString()],
  };
}

/**
 * Freshness probe for `/api/monitor/health`.
 *
 * Every read is index-driven: the newest row comes off the
 * `(ingestion_timestamp DESC)` btree and each window count is a range scan on
 * the same index, so polling this every few seconds never scans the buffer.
 */
export function freshnessQuery(): PgQuery {
  return {
    text: `
  WITH latest AS (
    SELECT t.ingestion_timestamp, t.traded_ts
    FROM ${LAKEBASE_FQN} t
    ORDER BY t.ingestion_timestamp DESC
    LIMIT 1
  )
  SELECT
      (SELECT l.ingestion_timestamp FROM latest l) AS last_ingestion,
      (SELECT l.traded_ts FROM latest l)           AS last_traded,
      (SELECT EXTRACT(EPOCH FROM (now() - l.ingestion_timestamp))::double precision FROM latest l) AS ingestion_age_seconds,
      (SELECT EXTRACT(EPOCH FROM (now() - l.traded_ts))::double precision FROM latest l)           AS traded_age_seconds,
      (SELECT COUNT(*) FROM ${LAKEBASE_FQN} t WHERE t.ingestion_timestamp > now() - INTERVAL '1 minute')::double precision  AS rows_1m,
      (SELECT COUNT(*) FROM ${LAKEBASE_FQN} t WHERE t.ingestion_timestamp > now() - INTERVAL '5 minutes')::double precision AS rows_5m,
      (SELECT COUNT(*) FROM ${LAKEBASE_FQN} t WHERE t.ingestion_timestamp > now() - INTERVAL '1 hour')::double precision    AS rows_1h`,
    values: [],
  };
}
