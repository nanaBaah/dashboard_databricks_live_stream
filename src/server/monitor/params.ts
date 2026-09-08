/**
 * Request parsing and validation for the monitor endpoints.
 *
 * Filters are bound as SQL parameters everywhere, so validation here is about
 * failing fast with a 422 instead of running a nonsense query — never a 500,
 * per Story 4.3's acceptance criteria.
 */

import { MAX_RANGE_DAYS } from "../config.js";

/** Thrown for bad client input; mapped to HTTP 422 by the route layer. */
export class InvalidRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidRequestError";
  }
}

/** Bucket widths the time-series panels may use, in seconds. */
export const BUCKET_CHOICES = [60, 300, 900, 1_800, 3_600, 10_800, 21_600, 43_200, 86_400] as const;

/** Target number of points in a time series; drives automatic bucket choice. */
const TARGET_BUCKETS = 150;

/** Hard cap on scatter points requested per source. */
export const MAX_PRODUCT_POINTS = 1_500;

/** The empty-string sentinel that means "no filter" for a bound text parameter. */
export const ANY = "";

export interface MonitorFilters {
  /** Inclusive lower bound on `traded_ts`. */
  from: Date;
  /** Exclusive upper bound on `traded_ts`. */
  to: Date;
  /** Two-letter country (or "Other"), or `ANY`. */
  country: string;
  /** Product type label such as "15 min", or `ANY`. */
  productType: string;
  /** "BUY" | "SELL", or `ANY`. */
  side: string;
  /** Time-bucket width for the series panels, in seconds. */
  bucketSeconds: number;
}

function parseInstant(raw: unknown, label: string, fallback: Date): Date {
  if (raw === undefined || raw === "") return fallback;
  if (typeof raw !== "string") throw new InvalidRequestError(`${label} must be a single ISO timestamp`);
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) throw new InvalidRequestError(`${label} is not a valid ISO timestamp: "${raw}"`);
  return new Date(ms);
}

function parseEnum(raw: unknown, label: string, pattern: RegExp, transform: (v: string) => string): string {
  if (raw === undefined || raw === "" || raw === "ALL") return ANY;
  if (typeof raw !== "string") throw new InvalidRequestError(`${label} must be a single value`);
  const value = transform(raw);
  if (!pattern.test(value)) throw new InvalidRequestError(`${label} is not a recognised value: "${raw}"`);
  return value;
}

/**
 * Pick the narrowest bucket that keeps a series under `TARGET_BUCKETS` points,
 * so a 1 h range gets minute resolution and a 90 d range gets daily.
 */
export function autoBucketSeconds(spanSeconds: number): number {
  for (const choice of BUCKET_CHOICES) {
    if (spanSeconds / choice <= TARGET_BUCKETS) return choice;
  }
  return BUCKET_CHOICES[BUCKET_CHOICES.length - 1]!;
}

/** Parse and validate the shared filter set from an Express query object. */
export function parseFilters(query: Record<string, unknown>, now: Date = new Date()): MonitorFilters {
  const to = parseInstant(query["to"], "to", now);
  const from = parseInstant(query["from"], "from", new Date(to.getTime() - 24 * 3_600_000));

  if (from.getTime() >= to.getTime()) {
    throw new InvalidRequestError("`from` must be strictly before `to`");
  }
  const spanSeconds = (to.getTime() - from.getTime()) / 1_000;
  if (spanSeconds > MAX_RANGE_DAYS * 86_400) {
    throw new InvalidRequestError(`traded time range exceeds the ${MAX_RANGE_DAYS}-day maximum`);
  }

  const country = parseEnum(query["country"], "country", /^(?:[A-Z]{2}|Other)$/, (v) =>
    v === "Other" ? v : v.toUpperCase(),
  );
  const productType = parseEnum(query["productType"], "productType", /^(?:\d{1,5} min|Unknown)$/, (v) => v);
  const side = parseEnum(query["side"], "side", /^(?:BUY|SELL)$/, (v) => v.toUpperCase());

  let bucketSeconds = autoBucketSeconds(spanSeconds);
  const rawBucket = query["bucket"];
  if (rawBucket !== undefined && rawBucket !== "" && rawBucket !== "auto") {
    const n = Number(rawBucket);
    if (!BUCKET_CHOICES.includes(n as (typeof BUCKET_CHOICES)[number])) {
      throw new InvalidRequestError(`bucket must be "auto" or one of ${BUCKET_CHOICES.join(", ")} seconds`);
    }
    bucketSeconds = n;
  }

  return { from, to, country, productType, side, bucketSeconds };
}
