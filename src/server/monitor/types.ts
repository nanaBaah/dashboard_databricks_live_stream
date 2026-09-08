/**
 * The shared aggregate contract that lets Lakebase and Delta results be merged.
 *
 * Every panel query returns ONLY additive (or associative) partial aggregates —
 * never a ratio. VWAP and average price are derived *after* the two sources are
 * merged, so a range that straddles the 48 h buffer boundary produces exactly
 * the same numbers as if one engine had answered the whole range:
 *
 *   vwap      = SUM(price * volume) / SUM(volume)     -> pv / volume
 *   avg price = SUM(price) / COUNT(price)             -> priceSum / priceCount
 *
 * Merging `AVG()` or a per-source VWAP would silently weight the two windows
 * equally instead of by volume, which is why the partials are the wire format.
 */

/** Additive partial aggregate for one group (a country, a time bucket, …). */
export interface Agg {
  /** COUNT(*) */
  trades: number;
  /** SUM(volume_mw) */
  volume: number;
  /** SUM(price_eur_mwh * volume_mw) — the VWAP numerator */
  pv: number;
  /** SUM(price_eur_mwh) */
  priceSum: number;
  /** COUNT(price_eur_mwh) — NULL prices excluded, so avg matches SQL AVG() */
  priceCount: number;
  /** MIN(price_eur_mwh), or null when the group has no priced trade */
  minPrice: number | null;
  /** MAX(price_eur_mwh), or null when the group has no priced trade */
  maxPrice: number | null;
}

/** Raw aggregate columns as returned by both engines (numbers after coercion). */
export interface AggColumns {
  trades: number;
  volume: number;
  pv: number;
  price_sum: number;
  price_count: number;
  min_price: number | null;
  max_price: number | null;
}

/** `GROUP BY country` — drives the KPI row and the volume-share donut. */
export type CountryRow = AggColumns & { country: string };

/** `GROUP BY <traded-time bucket>` — drives the VWAP-over-time line. */
export type TradedBucketRow = AggColumns & { bucket: number };

/** `GROUP BY <delivery bucket>, country` — drives both delivery-axis panels. */
export type DeliveryBucketRow = AggColumns & { bucket: number; country: string };

/** `GROUP BY product_key, side` — drives the price-vs-volume scatter. */
export type ProductRow = AggColumns & {
  product_key: string;
  side: string | null;
  country: string;
  product_type: string;
};

/** `GROUP BY country, product_type` — populates the filter dropdowns. */
export type DimensionRow = { country: string; product_type: string; trades: number; volume: number };

/** Which panel dataset a query builder produces. */
export type PanelKind = "country" | "tradedSeries" | "deliverySeries" | "products" | "dimensions";
