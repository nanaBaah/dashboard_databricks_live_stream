/**
 * Assembles the overview response: run the planned windows, merge the partial
 * aggregates, then derive the ratios and shapes the panels render.
 *
 * All derivation happens after the merge, so a hybrid range produces exactly
 * the numbers a single engine would have produced for the whole range.
 */

import type {
  CountryAggregateWire,
  DeliverySeriesWire,
  EnvelopePointWire,
  KpiWire,
  OverviewResponse,
  ProductPointWire,
  QueryPlanWire,
  TradedPointWire,
} from "../../../shared/monitor_contract.js";
import { BUFFER_HOURS } from "../config.js";
import { addAgg, aggFromColumns, deriveAvgPrice, deriveVwap, emptyAgg, mergeGroups } from "./aggregate.js";
import type { MonitorFilters } from "./params.js";
import type { QueryPlan } from "./plan.js";
import { fetchOverviewWindow, type PanelRows, type SourceDeps, type SourceStats } from "./sources.js";
import type { Agg } from "./types.js";

/** Countries drawn as their own series; the rest fold into "Other". */
const TOP_COUNTRIES = 5;

/**
 * Bucket label for everything outside the top countries.
 *
 * The derived `country` dimension already emits "Other" for an EIC that
 * matches neither pattern, so the long tail folds into that same catch-all
 * rather than competing with it for a named series slot.
 */
export const OTHER_COUNTRY = "Other";

/** Scatter marks returned after the merge, highest-volume first. */
const MAX_SCATTER_POINTS = 600;

/** Trim float noise so the JSON stays small and stable between polls. */
function round(value: number | null, digits = 4): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function roundRequired(value: number, digits = 4): number {
  return round(value, digits) ?? 0;
}

/** `eic|delivery_start_ms|delivery_end_ms` -> the delivery window, when parseable. */
function parseProductKey(productKey: string): { startMs: number | null; endMs: number | null } {
  const parts = productKey.split("|");
  const startMs = Number(parts[1]);
  const endMs = Number(parts[2]);
  return {
    startMs: Number.isFinite(startMs) && startMs > 0 ? startMs : null,
    endMs: Number.isFinite(endMs) && endMs > 0 ? endMs : null,
  };
}

export function toPlanWire(plan: QueryPlan, stats: SourceStats[]): QueryPlanWire {
  return {
    mode: plan.mode,
    boundary: plan.boundary.toISOString(),
    bufferHours: BUFFER_HOURS,
    sources: stats,
    partial: stats.some((s) => s.error !== null),
  };
}

export async function buildOverview(
  deps: SourceDeps,
  plan: QueryPlan,
  filters: MonitorFilters,
): Promise<OverviewResponse> {
  const results = await Promise.all(plan.windows.map((w) => fetchOverviewWindow(deps, w, filters)));
  const panels: PanelRows[] = results.map((r) => r.panels);
  const stats = results.map((r) => r.stats);

  // Countries -> KPI tiles + volume-share donut.
  const mergedCountries = mergeGroups(
    panels.map((p) => p.country),
    (row) => row.country,
    (row) => ({ country: row.country }),
    (row) => aggFromColumns(row),
  ).sort((a, b) => b.agg.volume - a.agg.volume || a.country.localeCompare(b.country));

  const total = mergedCountries.reduce((acc, entry) => addAgg(acc, entry.agg), emptyAgg());

  const countries: CountryAggregateWire[] = mergedCountries.map((entry) => ({
    country: entry.country,
    trades: entry.agg.trades,
    volume: roundRequired(entry.agg.volume),
    vwap: round(deriveVwap(entry.agg), 2),
    avgPrice: round(deriveAvgPrice(entry.agg), 2),
  }));

  const kpis: KpiWire = {
    trades: total.trades,
    volume: roundRequired(total.volume),
    vwap: round(deriveVwap(total), 2),
    avgPrice: round(deriveAvgPrice(total), 2),
    minPrice: round(total.minPrice, 2),
    maxPrice: round(total.maxPrice, 2),
  };

  const topCountries = mergedCountries
    .filter((entry) => entry.country !== OTHER_COUNTRY)
    .slice(0, TOP_COUNTRIES)
    .map((entry) => entry.country);

  // VWAP over traded time.
  const tradedSeries: TradedPointWire[] = mergeGroups(
    panels.map((p) => p.tradedSeries),
    (row) => String(row.bucket),
    (row) => ({ t: row.bucket }),
    (row) => aggFromColumns(row),
  )
    .sort((a, b) => a.t - b.t)
    .map((entry) => ({
      t: entry.t,
      vwap: round(deriveVwap(entry.agg), 2),
      avgPrice: round(deriveAvgPrice(entry.agg), 2),
      volume: roundRequired(entry.agg.volume),
      trades: entry.agg.trades,
    }));

  // Delivery axis: per-country lines and the min/VWAP/max envelope, both folded
  // out of one grouped result.
  const mergedDelivery = mergeGroups(
    panels.map((p) => p.deliverySeries),
    (row) => `${row.bucket} ${row.country}`,
    (row) => ({ t: row.bucket, country: row.country }),
    (row) => aggFromColumns(row),
  );

  const topSet = new Set(topCountries);
  const bySeries = new Map<string, Map<number, Agg>>();
  const byBucket = new Map<number, Agg>();

  for (const entry of mergedDelivery) {
    const label = topSet.has(entry.country) ? entry.country : OTHER_COUNTRY;
    let series = bySeries.get(label);
    if (!series) {
      series = new Map<number, Agg>();
      bySeries.set(label, series);
    }
    const existingSeries = series.get(entry.t);
    series.set(entry.t, existingSeries ? addAgg(existingSeries, entry.agg) : { ...entry.agg });

    const existingBucket = byBucket.get(entry.t);
    byBucket.set(entry.t, existingBucket ? addAgg(existingBucket, entry.agg) : { ...entry.agg });
  }

  const seriesOrder = [...topCountries, OTHER_COUNTRY];
  const deliveryByCountry: DeliverySeriesWire[] = seriesOrder
    .filter((country) => bySeries.has(country))
    .map((country) => ({
      country,
      points: [...bySeries.get(country)!.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([t, agg]) => ({
          t,
          vwap: round(deriveVwap(agg), 2),
          volume: roundRequired(agg.volume),
          trades: agg.trades,
        })),
    }));

  const deliveryEnvelope: EnvelopePointWire[] = [...byBucket.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, agg]) => ({
      t,
      vwap: round(deriveVwap(agg), 2),
      minPrice: round(agg.minPrice, 2),
      maxPrice: round(agg.maxPrice, 2),
      volume: roundRequired(agg.volume),
      trades: agg.trades,
    }));

  // Price vs volume per delivery contract and side.
  const mergedProducts = mergeGroups(
    panels.map((p) => p.products),
    (row) => `${row.product_key} ${row.side ?? ""}`,
    (row) => ({
      productKey: row.product_key,
      side: row.side,
      country: row.country,
      productType: row.product_type,
    }),
    (row) => aggFromColumns(row),
  ).sort((a, b) => b.agg.volume - a.agg.volume);

  const products: ProductPointWire[] = mergedProducts.slice(0, MAX_SCATTER_POINTS).map((entry) => {
    const { startMs, endMs } = parseProductKey(entry.productKey);
    return {
      productKey: entry.productKey,
      side: entry.side,
      country: entry.country,
      productType: entry.productType,
      deliveryStartMs: startMs,
      deliveryEndMs: endMs,
      avgPrice: round(deriveAvgPrice(entry.agg), 2),
      vwap: round(deriveVwap(entry.agg), 2),
      volume: roundRequired(entry.agg.volume),
      trades: entry.agg.trades,
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    range: {
      from: filters.from.toISOString(),
      to: filters.to.toISOString(),
      bucketSeconds: filters.bucketSeconds,
      country: filters.country || null,
      productType: filters.productType || null,
      side: filters.side || null,
    },
    plan: toPlanWire(plan, stats),
    kpis,
    countries,
    topCountries,
    tradedSeries,
    deliveryByCountry,
    deliveryEnvelope,
    products,
    productsTotal: mergedProducts.length,
  };
}
