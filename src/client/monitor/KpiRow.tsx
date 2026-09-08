/**
 * The three headline figures. A single number is a stat tile, not a chart —
 * hero figures use proportional digits, and the supporting detail sits in the
 * caption rather than in a second tile.
 */

import type { KpiWire } from "../../../shared/monitor_contract.js";
import { formatCount, formatPrice, formatVolume } from "./format.js";

export interface KpiRowProps {
  kpis: KpiWire;
  countryCount: number;
  dimmed?: boolean;
}

function StatTile({ label, value, caption }: { label: string; value: string; caption: string }) {
  return (
    <div className="stat-tile">
      <div className="stat-tile__label">{label}</div>
      <div className="stat-tile__value">{value}</div>
      <div className="stat-tile__caption">{caption}</div>
    </div>
  );
}

export function KpiRow({ kpis, countryCount, dimmed = false }: KpiRowProps) {
  return (
    <div className={`stat-row${dimmed ? " stat-row--dimmed" : ""}`}>
      <StatTile
        label="Trade count"
        value={formatCount(kpis.trades)}
        caption={`across ${countryCount} ${countryCount === 1 ? "country" : "countries"}`}
      />
      <StatTile
        label="VWAP (EUR/MWh)"
        value={formatPrice(kpis.vwap)}
        caption={`min ${formatPrice(kpis.minPrice)} · max ${formatPrice(kpis.maxPrice)}`}
      />
      <StatTile
        label="Total volume (MW)"
        value={formatVolume(kpis.volume)}
        caption={`avg price ${formatPrice(kpis.avgPrice)} EUR/MWh`}
      />
    </div>
  );
}
