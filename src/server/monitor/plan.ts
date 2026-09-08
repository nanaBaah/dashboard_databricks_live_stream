/**
 * Source routing — the rule that decides which engine answers a request.
 *
 * Lakebase holds a rolling `BUFFER_HOURS` window and is fast; Delta holds
 * everything and is slow. The traded time range is therefore split at a single
 * boundary:
 *
 *     |------------------- Delta (history) -------------------|--- Lakebase (live) ---|
 *   -inf                                                  boundary                   now
 *
 * The split is half-open on both sides (`[from, boundary)` and `[boundary, to)`),
 * so a trade is counted exactly once even though Delta also holds the last 48 h.
 * A range entirely inside the buffer never touches the warehouse; a range
 * entirely outside it never touches Postgres; a straddling range runs both and
 * the partial aggregates are merged (see `aggregate.ts`).
 */

import { BUFFER_HOURS, BUFFER_SAFETY_MINUTES } from "../config.js";
import type { MonitorFilters } from "./params.js";

export type SourceName = "lakebase" | "delta";

/** One engine plus the half-open traded-time window it must answer for. */
export interface SourceWindow {
  source: SourceName;
  from: Date;
  to: Date;
}

export interface QueryPlan {
  /** The windows to execute, in ascending time order. Never empty. */
  windows: SourceWindow[];
  /** The traded-time instant at which history hands over to the live buffer. */
  boundary: Date;
  /** `live` = Lakebase only, `history` = Delta only, `hybrid` = both. */
  mode: "live" | "history" | "hybrid";
}

/**
 * The oldest `traded_ts` that Lakebase is guaranteed to still hold.
 *
 * `BUFFER_SAFETY_MINUTES` is shaved off the nominal window so a row near the
 * eviction edge is served from Delta (which always has it) rather than being
 * missed by a Lakebase query that races the trim job.
 */
export function bufferBoundary(now: Date): Date {
  const coveredMs = BUFFER_HOURS * 3_600_000 - BUFFER_SAFETY_MINUTES * 60_000;
  return new Date(now.getTime() - Math.max(coveredMs, 0));
}

export function planSources(filters: Pick<MonitorFilters, "from" | "to">, now: Date = new Date()): QueryPlan {
  const boundary = bufferBoundary(now);

  if (filters.to.getTime() <= boundary.getTime()) {
    return {
      windows: [{ source: "delta", from: filters.from, to: filters.to }],
      boundary,
      mode: "history",
    };
  }

  if (filters.from.getTime() >= boundary.getTime()) {
    return {
      windows: [{ source: "lakebase", from: filters.from, to: filters.to }],
      boundary,
      mode: "live",
    };
  }

  return {
    windows: [
      { source: "delta", from: filters.from, to: boundary },
      { source: "lakebase", from: boundary, to: filters.to },
    ],
    boundary,
    mode: "hybrid",
  };
}

/** True when the requested range runs up to "now" and should keep auto-refreshing. */
export function isLiveRange(filters: Pick<MonitorFilters, "to">, now: Date = new Date()): boolean {
  return filters.to.getTime() >= now.getTime() - 60_000;
}
