/**
 * Wire contract for the Intraday Public Trades — Live Monitor endpoints.
 *
 * Types only: imported with `import type` by both the Express routes and the
 * React client, so the two can never drift, and nothing is emitted into either
 * bundle.
 */

/** Which engine answered, and how it went. */
export interface SourceStatsWire {
  source: "lakebase" | "delta";
  /** Display label, e.g. "Lakebase Postgres". */
  engine: string;
  /** Half-open traded-time window this source answered for. */
  from: string;
  to: string;
  durationMs: number;
  rows: number;
  /** Non-null when the window failed; its slice is missing from the response. */
  error: string | null;
}

/** How the request was routed across the 48 h buffer boundary. */
export interface QueryPlanWire {
  /** `live` = Lakebase only · `history` = Delta only · `hybrid` = both, merged. */
  mode: "live" | "history" | "hybrid";
  /** Traded-time instant where Delta hands over to the live buffer. */
  boundary: string;
  /** Nominal Lakebase buffer size, in hours. */
  bufferHours: number;
  sources: SourceStatsWire[];
  /** True when at least one source failed, so the numbers cover part of the range. */
  partial: boolean;
}

export interface RangeWire {
  from: string;
  to: string;
  /** Time-bucket width used by the series panels, in seconds. */
  bucketSeconds: number;
  country: string | null;
  productType: string | null;
  side: string | null;
}

/** The headline tiles. */
export interface KpiWire {
  trades: number;
  volume: number;
  vwap: number | null;
  avgPrice: number | null;
  minPrice: number | null;
  maxPrice: number | null;
}

export interface CountryAggregateWire {
  country: string;
  trades: number;
  volume: number;
  vwap: number | null;
  avgPrice: number | null;
}

/** One point of the VWAP-over-traded-time line. `t` is epoch seconds. */
export interface TradedPointWire {
  t: number;
  vwap: number | null;
  avgPrice: number | null;
  volume: number;
  trades: number;
}

/** One point of a per-country delivery series. */
export interface DeliveryPointWire {
  t: number;
  vwap: number | null;
  volume: number;
  trades: number;
}

export interface DeliverySeriesWire {
  country: string;
  points: DeliveryPointWire[];
}

/** One point of the min / VWAP / max price envelope over delivery time. */
export interface EnvelopePointWire {
  t: number;
  vwap: number | null;
  minPrice: number | null;
  maxPrice: number | null;
  volume: number;
  trades: number;
}

/** One scatter mark: a delivery contract's traded volume vs its average price. */
export interface ProductPointWire {
  productKey: string;
  side: string | null;
  country: string;
  productType: string;
  /** Delivery window parsed out of `product_key`, epoch ms; null if unparseable. */
  deliveryStartMs: number | null;
  deliveryEndMs: number | null;
  avgPrice: number | null;
  vwap: number | null;
  volume: number;
  trades: number;
}

export interface OverviewResponse {
  generatedAt: string;
  range: RangeWire;
  plan: QueryPlanWire;
  kpis: KpiWire;
  /** Every country in the slice, volume-descending. */
  countries: CountryAggregateWire[];
  /** The countries drawn as their own series; everything else folds into "Other". */
  topCountries: string[];
  tradedSeries: TradedPointWire[];
  /** Already folded to `topCountries` + "Other". */
  deliveryByCountry: DeliverySeriesWire[];
  deliveryEnvelope: EnvelopePointWire[];
  products: ProductPointWire[];
  /** Total contracts before the scatter was trimmed for rendering. */
  productsTotal: number;
}

export interface DimensionsResponse {
  range: Pick<RangeWire, "from" | "to">;
  plan: QueryPlanWire;
  /** Countries in the range, volume-descending — the stable colour ranking. */
  countries: Array<{ country: string; trades: number; volume: number }>;
  productTypes: Array<{ productType: string; trades: number; volume: number }>;
}

export type HealthStatus = "ok" | "lagging" | "stale" | "unknown";

export interface HealthResponse {
  status: HealthStatus;
  lakebase: {
    reachable: boolean;
    lastIngestion: string | null;
    lastTraded: string | null;
    freshnessSeconds: number | null;
    tradedLagSeconds: number | null;
    rows1m: number;
    rows5m: number;
    rows1h: number;
    error: string | null;
  };
  delta: {
    reachable: boolean;
    lastIngestion: string | null;
    freshnessSeconds: number | null;
    error: string | null;
  };
  thresholds: { laggingSeconds: number; staleSeconds: number };
  bufferHours: number;
}
