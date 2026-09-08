/**
 * Display formatting for the monitor.
 *
 * Timestamps render in market time (CET/CEST) because delivery periods,
 * `delivery_hour` and `trade_date` are all defined in that zone upstream —
 * showing them in the viewer's local zone would put a "17:00-17:15" contract
 * at a different clock time than the traders quoting it.
 */

/** The market's timezone; every timestamp on screen is rendered in it. */
export const MARKET_TZ = "Europe/Berlin";

const compactNumber = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 });
const plainNumber = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const price2 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const volume3 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 });

const timeOnly = new Intl.DateTimeFormat("en-GB", {
  timeZone: MARKET_TZ,
  hour: "2-digit",
  minute: "2-digit",
});
const dayOnly = new Intl.DateTimeFormat("en-GB", { timeZone: MARKET_TZ, day: "2-digit", month: "short" });
const monthOnly = new Intl.DateTimeFormat("en-GB", { timeZone: MARKET_TZ, month: "short", year: "numeric" });
const fullInstant = new Intl.DateTimeFormat("en-GB", {
  timeZone: MARKET_TZ,
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZoneName: "short",
});
const dateTimeShort = new Intl.DateTimeFormat("en-GB", {
  timeZone: MARKET_TZ,
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

/** Large counts, e.g. `946.37K`. */
export function formatCount(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return Math.abs(value) >= 10_000 ? compactNumber.format(value) : plainNumber.format(value);
}

/** Volumes in MW, compact for headline figures. */
export function formatVolume(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return Math.abs(value) >= 10_000 ? compactNumber.format(value) : volume3.format(value);
}

/** Prices in EUR/MWh, always two decimals. */
export function formatPrice(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return price2.format(value);
}

/** Axis ticks stay short; the tooltip carries the precise value. */
export function formatAxisNumber(value: number): string {
  return Math.abs(value) >= 1_000 ? compactNumber.format(value) : price2.format(value).replace(/\.00$/, "");
}

/**
 * Tick label for an epoch-second value, at a granularity chosen from the
 * visible span so a 6 h window shows clock times and a 30 d window shows dates.
 */
export function makeTickFormatter(spanSeconds: number): (epochSeconds: number) => string {
  if (spanSeconds <= 2 * 86_400) return (t) => timeOnly.format(new Date(t * 1_000));
  if (spanSeconds <= 120 * 86_400) return (t) => dayOnly.format(new Date(t * 1_000));
  return (t) => monthOnly.format(new Date(t * 1_000));
}

/** Full timestamp for tooltips and the header. */
export function formatInstant(epochSeconds: number): string {
  return fullInstant.format(new Date(epochSeconds * 1_000));
}

export function formatIsoInstant(iso: string | null): string {
  if (iso === null) return "—";
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? fullInstant.format(new Date(ms)) : "—";
}

export function formatIsoShort(iso: string): string {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? dateTimeShort.format(new Date(ms)) : iso;
}

/** "2.4 s", "3 m 10 s" — used for freshness and query timings. */
export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "—";
  if (seconds < 1) return `${Math.round(seconds * 1_000)} ms`;
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} m ${Math.round(seconds % 60)} s`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} m`;
}

export function formatMillis(ms: number): string {
  return ms < 1_000 ? `${Math.round(ms)} ms` : `${(ms / 1_000).toFixed(1)} s`;
}

/**
 * Human label for a delivery contract, e.g. `FR 17:00-17:15 (23 Sep)`.
 * Falls back to the raw product key when the delivery window is unparseable.
 */
export function formatContract(
  country: string,
  startMs: number | null,
  endMs: number | null,
  productKey: string,
): string {
  if (startMs === null || endMs === null) return productKey;
  const start = new Date(startMs);
  const end = new Date(endMs);
  return `${country} ${timeOnly.format(start)}–${timeOnly.format(end)} (${dayOnly.format(start)})`;
}

/** Bucket-width label for the panel subtitles. */
export function formatBucket(seconds: number): string {
  if (seconds % 86_400 === 0) return `${seconds / 86_400} d`;
  if (seconds % 3_600 === 0) return `${seconds / 3_600} h`;
  return `${seconds / 60} min`;
}
