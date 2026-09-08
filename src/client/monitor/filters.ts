/**
 * Dashboard filter state: presets, URL round-tripping, and the query strings
 * the API is called with.
 *
 * The traded time range is the control that decides which engine answers, so
 * the presets are named for that: everything up to "Last 48 h" stays inside the
 * Lakebase buffer, anything longer reaches into Delta.
 */

export type PresetKey = "1h" | "6h" | "24h" | "48h" | "7d" | "30d" | "custom";

export interface RangePreset {
  key: PresetKey;
  label: string;
  seconds: number;
}

/** Relative ranges, newest-first. `custom` is handled separately. */
export const RANGE_PRESETS: RangePreset[] = [
  { key: "1h", label: "Last hour", seconds: 3_600 },
  { key: "6h", label: "Last 6 hours", seconds: 21_600 },
  { key: "24h", label: "Last 24 hours", seconds: 86_400 },
  { key: "48h", label: "Last 48 hours", seconds: 172_800 },
  { key: "7d", label: "Last 7 days", seconds: 604_800 },
  { key: "30d", label: "Last 30 days", seconds: 2_592_000 },
];

/** Auto-refresh choices, in milliseconds; `0` means off. */
export const REFRESH_CHOICES = [
  { value: 0, label: "Off" },
  { value: 2_000, label: "2 s" },
  { value: 5_000, label: "5 s" },
  { value: 15_000, label: "15 s" },
  { value: 60_000, label: "1 min" },
];

export interface FilterState {
  preset: PresetKey;
  /** Only used when `preset === "custom"`; `datetime-local` strings. */
  customFrom: string;
  customTo: string;
  country: string;
  productType: string;
  side: string;
  refreshMs: number;
}

export const DEFAULT_FILTERS: FilterState = {
  preset: "24h",
  customFrom: "",
  customTo: "",
  country: "",
  productType: "",
  side: "",
  refreshMs: 5_000,
};

export interface ResolvedRange {
  from: Date;
  to: Date;
  /** True when the range tracks "now" and should keep polling. */
  live: boolean;
}

/** `datetime-local` value (local wall time) for a Date. */
export function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/** Turn the filter state into a concrete traded-time window. */
export function resolveRange(state: FilterState, now: Date = new Date()): ResolvedRange {
  if (state.preset === "custom") {
    const from = new Date(state.customFrom);
    const to = new Date(state.customTo);
    if (Number.isFinite(from.getTime()) && Number.isFinite(to.getTime()) && from < to) {
      return { from, to, live: false };
    }
    // Fall through to the default window while a custom range is half-typed.
  }
  const preset = RANGE_PRESETS.find((p) => p.key === state.preset) ?? RANGE_PRESETS[2]!;
  return { from: new Date(now.getTime() - preset.seconds * 1_000), to: now, live: true };
}

/** Query string for `/api/monitor/overview` and `/api/monitor/dimensions`. */
export function toQuery(state: FilterState, range: ResolvedRange, includeDimensions = true): string {
  const params = new URLSearchParams({ from: range.from.toISOString(), to: range.to.toISOString() });
  if (includeDimensions) {
    if (state.country) params.set("country", state.country);
    if (state.productType) params.set("productType", state.productType);
    if (state.side) params.set("side", state.side);
  }
  return params.toString();
}

/**
 * Key that changes only when a *new fetch series* is needed — deliberately
 * excludes the resolved range, whose `to` moves every second on a live preset.
 */
export function filterKey(state: FilterState, includeDimensions = true): string {
  return [
    state.preset,
    state.preset === "custom" ? state.customFrom : "",
    state.preset === "custom" ? state.customTo : "",
    includeDimensions ? state.country : "",
    includeDimensions ? state.productType : "",
    includeDimensions ? state.side : "",
  ].join("|");
}

/** Read filter state out of the page URL, so a dashboard link is shareable. */
export function fromSearchParams(search: string): FilterState {
  const params = new URLSearchParams(search);
  const preset = params.get("range");
  // `Number(null)` is 0, which is a *valid* choice ("Off"), so an absent
  // parameter has to be distinguished from an explicit `refresh=0`.
  const rawRefresh = params.get("refresh");
  const refresh = rawRefresh === null ? Number.NaN : Number(rawRefresh);
  return {
    preset: isPreset(preset) ? preset : DEFAULT_FILTERS.preset,
    customFrom: params.get("from") ?? "",
    customTo: params.get("to") ?? "",
    country: params.get("country") ?? "",
    productType: params.get("productType") ?? "",
    side: params.get("side") ?? "",
    refreshMs: REFRESH_CHOICES.some((choice) => choice.value === refresh) ? refresh : DEFAULT_FILTERS.refreshMs,
  };
}

export function toSearchParams(state: FilterState): string {
  const params = new URLSearchParams();
  params.set("range", state.preset);
  if (state.preset === "custom") {
    if (state.customFrom) params.set("from", state.customFrom);
    if (state.customTo) params.set("to", state.customTo);
  }
  if (state.country) params.set("country", state.country);
  if (state.productType) params.set("productType", state.productType);
  if (state.side) params.set("side", state.side);
  if (state.refreshMs !== DEFAULT_FILTERS.refreshMs) params.set("refresh", String(state.refreshMs));
  return params.toString();
}

function isPreset(value: string | null): value is PresetKey {
  return value !== null && (value === "custom" || RANGE_PRESETS.some((preset) => preset.key === value));
}
