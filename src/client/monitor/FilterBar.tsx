/**
 * One filter row above everything it scopes — never per-panel filters, so all
 * five panels always render the same slice.
 */

import type { DimensionsResponse } from "../../../shared/monitor_contract.js";
import { formatIsoShort } from "./format.js";
import { RANGE_PRESETS, REFRESH_CHOICES, toLocalInput, type FilterState, type ResolvedRange } from "./filters.js";

export interface FilterBarProps {
  value: FilterState;
  onChange: (next: FilterState) => void;
  range: ResolvedRange;
  dimensions: DimensionsResponse | null;
  onRefreshNow: () => void;
  busy: boolean;
}

export function FilterBar({ value, onChange, range, dimensions, onRefreshNow, busy }: FilterBarProps) {
  const set = <K extends keyof FilterState>(key: K, next: FilterState[K]) =>
    onChange({ ...value, [key]: next });

  const startCustom = () => {
    onChange({
      ...value,
      preset: "custom",
      customFrom: value.customFrom || toLocalInput(range.from),
      customTo: value.customTo || toLocalInput(range.to),
    });
  };

  return (
    <div className="filter-bar">
      <label className="filter">
        <span className="filter__label">Traded time range</span>
        <select
          className="filter__control"
          value={value.preset}
          onChange={(event) => {
            const next = event.target.value;
            if (next === "custom") startCustom();
            else set("preset", next as FilterState["preset"]);
          }}
        >
          {RANGE_PRESETS.map((preset) => (
            <option key={preset.key} value={preset.key}>
              {preset.label}
            </option>
          ))}
          <option value="custom">Custom…</option>
        </select>
      </label>

      {value.preset === "custom" && (
        <>
          <label className="filter">
            <span className="filter__label">From</span>
            <input
              className="filter__control"
              type="datetime-local"
              value={value.customFrom}
              onChange={(event) => set("customFrom", event.target.value)}
            />
          </label>
          <label className="filter">
            <span className="filter__label">To</span>
            <input
              className="filter__control"
              type="datetime-local"
              value={value.customTo}
              onChange={(event) => set("customTo", event.target.value)}
            />
          </label>
        </>
      )}

      <label className="filter">
        <span className="filter__label">Country</span>
        <select
          className="filter__control"
          value={value.country}
          onChange={(event) => set("country", event.target.value)}
        >
          <option value="">All</option>
          {(dimensions?.countries ?? []).map((entry) => (
            <option key={entry.country} value={entry.country}>
              {entry.country}
            </option>
          ))}
        </select>
      </label>

      <label className="filter">
        <span className="filter__label">Product type</span>
        <select
          className="filter__control"
          value={value.productType}
          onChange={(event) => set("productType", event.target.value)}
        >
          <option value="">All</option>
          {(dimensions?.productTypes ?? []).map((entry) => (
            <option key={entry.productType} value={entry.productType}>
              {entry.productType}
            </option>
          ))}
        </select>
      </label>

      <label className="filter">
        <span className="filter__label">Side</span>
        <select className="filter__control" value={value.side} onChange={(event) => set("side", event.target.value)}>
          <option value="">All</option>
          <option value="BUY">BUY</option>
          <option value="SELL">SELL</option>
        </select>
      </label>

      <label className="filter">
        <span className="filter__label">Auto-refresh</span>
        <select
          className="filter__control"
          value={value.refreshMs}
          onChange={(event) => set("refreshMs", Number(event.target.value))}
          disabled={!range.live}
          title={range.live ? undefined : "A custom range is fixed in time, so it does not auto-refresh"}
        >
          {REFRESH_CHOICES.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </select>
      </label>

      <button type="button" className="filter__button" onClick={onRefreshNow} disabled={busy}>
        {busy ? "Refreshing…" : "Refresh now"}
      </button>

      <p className="filter-bar__range">
        {formatIsoShort(range.from.toISOString())} → {formatIsoShort(range.to.toISOString())}
      </p>
    </div>
  );
}
