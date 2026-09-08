/**
 * Merge helpers for the two-source query planner.
 *
 * `mergeGroups` folds the partial aggregates from Lakebase and Delta into one
 * keyed map; the `derive*` helpers turn a merged partial into the ratios the
 * dashboard displays. See `types.ts` for why ratios are computed last.
 */

import type { Agg, AggColumns } from "./types.js";

export function emptyAgg(): Agg {
  return { trades: 0, volume: 0, pv: 0, priceSum: 0, priceCount: 0, minPrice: null, maxPrice: null };
}

/** Coerce a value that may arrive as a string (node-postgres NUMERIC, Databricks JSON). */
export function toNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string" && value !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** Coerce a nullable numeric column, preserving "no value" as null. */
export function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Lift the raw aggregate columns of one result row into an `Agg`. */
export function aggFromColumns(row: AggColumns): Agg {
  return {
    trades: toNumber(row.trades),
    volume: toNumber(row.volume),
    pv: toNumber(row.pv),
    priceSum: toNumber(row.price_sum),
    priceCount: toNumber(row.price_count),
    minPrice: toNullableNumber(row.min_price),
    maxPrice: toNullableNumber(row.max_price),
  };
}

/** Add `b` into `a` in place. Min/max fold with null meaning "no contribution". */
export function addAgg(a: Agg, b: Agg): Agg {
  a.trades += b.trades;
  a.volume += b.volume;
  a.pv += b.pv;
  a.priceSum += b.priceSum;
  a.priceCount += b.priceCount;
  if (b.minPrice !== null) a.minPrice = a.minPrice === null ? b.minPrice : Math.min(a.minPrice, b.minPrice);
  if (b.maxPrice !== null) a.maxPrice = a.maxPrice === null ? b.maxPrice : Math.max(a.maxPrice, b.maxPrice);
  return a;
}

/** Volume-weighted average price, or null when the group carries no volume. */
export function deriveVwap(agg: Agg): number | null {
  return agg.volume > 0 ? agg.pv / agg.volume : null;
}

/** Arithmetic mean price over trades that carried a price. */
export function deriveAvgPrice(agg: Agg): number | null {
  return agg.priceCount > 0 ? agg.priceSum / agg.priceCount : null;
}

/**
 * Fold rows from every source into one entry per group key, preserving the
 * first-seen extra columns (country, product_type, …) alongside the aggregate.
 */
export function mergeGroups<TRow, TMeta>(
  rowSets: TRow[][],
  keyOf: (row: TRow) => string,
  metaOf: (row: TRow) => TMeta,
  aggOf: (row: TRow) => Agg,
): Array<TMeta & { key: string; agg: Agg }> {
  const merged = new Map<string, TMeta & { key: string; agg: Agg }>();
  for (const rows of rowSets) {
    for (const row of rows) {
      const key = keyOf(row);
      const existing = merged.get(key);
      if (existing) {
        addAgg(existing.agg, aggOf(row));
      } else {
        merged.set(key, { ...metaOf(row), key, agg: aggOf(row) });
      }
    }
  }
  return [...merged.values()];
}
