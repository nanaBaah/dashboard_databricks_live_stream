/**
 * Chart palette and colour assignment.
 *
 * The dashboard renders on a dark surface only (it mirrors the Databricks
 * dashboard it replaces), so these are the *dark* steps of the categorical
 * palette, selected for the dark band rather than flipped from a light one.
 *
 * Validated against the chart surface `--panel` (#141922) with the data-viz
 * validator: lightness band, chroma floor, adjacent-pair CVD separation
 * (worst 8.4 protan), normal-vision separation (worst 19.3) and >= 3:1
 * contrast all pass for the eight slots; slots 1-2, used for the scatter's
 * BUY/SELL split, also pass the stricter all-pairs gate (CVD 26.8).
 *
 * Two rules the assignment functions exist to enforce:
 *   - hues are handed out in fixed slot order, never cycled past eight;
 *   - a colour follows the entity, not its rank in the current slice, so
 *     filtering the dashboard never repaints the surviving series.
 */

/** Categorical slots, in the fixed order they must be assigned. */
export const SERIES_COLORS = [
  "#3987e5", // 1 blue
  "#d95926", // 2 orange
  "#199e70", // 3 aqua
  "#c98500", // 4 yellow
  "#d55181", // 5 magenta
  "#008300", // 6 green
  "#9085e9", // 7 violet
  "#e66767", // 8 red
] as const;

/** Everything outside the named slots: the "Other" bucket and unranked entities. */
export const NEUTRAL_SERIES = "#8b95a6";

/** The catch-all country bucket — unmapped EICs plus the folded long tail. */
export const OTHER_COUNTRY = "Other";

/** BUY / SELL use the two slots that clear the all-pairs gate for scatter marks. */
export const SIDE_COLORS: Record<string, string> = {
  BUY: SERIES_COLORS[0],
  SELL: SERIES_COLORS[1],
};

export function sideColor(side: string | null): string {
  return (side !== null && SIDE_COLORS[side]) || NEUTRAL_SERIES;
}

/**
 * Map country codes to fixed hues from a *stable* ranking.
 *
 * Pass the ranking from `/api/monitor/dimensions`, which depends only on the
 * traded time range — not on the country/product/side filters. That way DE
 * keeps its hue whether it is rank 1 of twenty or the only series left after
 * a filter. Countries past the eighth slot, and "Other", render neutral.
 */
export function buildCountryColors(rankedCountries: string[]): Map<string, string> {
  const colors = new Map<string, string>([[OTHER_COUNTRY, NEUTRAL_SERIES]]);
  let slot = 0;
  for (const country of rankedCountries) {
    if (country === OTHER_COUNTRY || colors.has(country)) continue;
    if (slot >= SERIES_COLORS.length) break;
    colors.set(country, SERIES_COLORS[slot]!);
    slot += 1;
  }
  return colors;
}

export function countryColor(colors: Map<string, string>, country: string): string {
  return colors.get(country) ?? NEUTRAL_SERIES;
}

/** Chart chrome, matched to the dark surface these charts are painted on. */
export const CHART_INK = {
  primary: "#ffffff",
  secondary: "#9aa4b2",
  muted: "#8b95a6",
  grid: "#232a36",
  axis: "#2f3846",
  surface: "#141922",
} as const;
