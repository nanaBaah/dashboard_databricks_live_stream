/**
 * Status surfaces: which engines answered, how fresh the live buffer is, and a
 * banner when part of the range is missing.
 *
 * The routing badge is deliberately prominent — a number that came from the
 * warehouse and a number that came from the 48 h buffer should never look
 * identical to the person reading them.
 */

import type { HealthResponse, QueryPlanWire } from "../../../shared/monitor_contract.js";
import { formatDuration, formatIsoInstant, formatIsoShort, formatMillis } from "./format.js";

const MODE_LABEL: Record<QueryPlanWire["mode"], string> = {
  live: "Live · Lakebase",
  history: "History · Delta",
  hybrid: "Hybrid · Delta + Lakebase",
};

/** Which engines served this response, and how long each took. */
export function SourceBadge({ plan }: { plan: QueryPlanWire }) {
  const detail = plan.sources
    .map((source) => `${source.engine}: ${formatIsoShort(source.from)} → ${formatIsoShort(source.to)}`)
    .join("\n");

  return (
    <div className={`source-badge source-badge--${plan.mode}`} title={detail}>
      <span className="source-badge__mode">{MODE_LABEL[plan.mode]}</span>
      <span className="source-badge__detail">
        {plan.sources.map((source) => (
          <span
            key={source.source}
            className={`source-badge__chip${source.error ? " source-badge__chip--error" : ""}`}
          >
            {source.source === "lakebase" ? "Lakebase" : "Delta"} {formatMillis(source.durationMs)}
          </span>
        ))}
      </span>
    </div>
  );
}

/** Freshness of the live buffer, from `/api/monitor/health`. */
export function FreshnessDot({ health }: { health: HealthResponse | null }) {
  const status = health?.status ?? "unknown";
  const label =
    status === "ok"
      ? "Live"
      : status === "lagging"
        ? "Lagging"
        : status === "stale"
          ? "Stale"
          : "Unknown";

  const tooltip = health
    ? [
        `Lakebase last ingestion: ${formatIsoInstant(health.lakebase.lastIngestion)}`,
        `Lakebase freshness: ${formatDuration(health.lakebase.freshnessSeconds)}`,
        `Rows last minute: ${health.lakebase.rows1m.toLocaleString()}`,
        `Delta last ingestion: ${formatIsoInstant(health.delta.lastIngestion)}`,
        `Thresholds: lagging > ${health.thresholds.laggingSeconds}s, stale > ${health.thresholds.staleSeconds}s`,
      ].join("\n")
    : "Pipeline freshness unavailable";

  return (
    <span className="freshness" title={tooltip}>
      <span className={`freshness__dot freshness__dot--${status}`} aria-hidden="true" />
      <span className="freshness__label">
        {label}
        {health?.lakebase.freshnessSeconds !== null && health !== null && (
          <span className="freshness__age"> · {formatDuration(health.lakebase.freshnessSeconds)} behind</span>
        )}
      </span>
    </span>
  );
}

/** Shown when a source failed, so partial numbers are never read as complete. */
export function PartialBanner({ plan }: { plan: QueryPlanWire }) {
  const failed = plan.sources.filter((source) => source.error !== null);
  if (failed.length === 0) return null;

  return (
    <div className="banner banner--warning" role="alert">
      <strong>Partial results.</strong> {failed.length === 1 ? "One source" : "Both sources"} failed, so these
      numbers cover only part of the selected range.
      <ul className="banner__list">
        {failed.map((source) => (
          <li key={source.source}>
            <span className="banner__source">{source.engine}</span> ({formatIsoShort(source.from)} →{" "}
            {formatIsoShort(source.to)}): {source.error}
          </li>
        ))}
      </ul>
    </div>
  );
}
