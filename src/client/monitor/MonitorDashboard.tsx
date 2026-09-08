/**
 * Intraday Public Trades — Live Monitor.
 *
 * One filter row scopes every panel; the server decides, from the traded time
 * range alone, whether that slice comes from the Lakebase buffer, the Delta
 * history, or both merged. The header keeps that decision visible.
 */

import { useEffect, useMemo, useState } from "react";

import { buildCountryColors } from "../charts/palette.js";
import { FilterBar } from "./FilterBar.js";
import { KpiRow } from "./KpiRow.js";
import {
  DEFAULT_FILTERS,
  filterKey,
  fromSearchParams,
  resolveRange,
  toQuery,
  toSearchParams,
  type FilterState,
} from "./filters.js";
import { formatIsoShort } from "./format.js";
import {
  CountryVolumePanel,
  DeliveryVwapPanel,
  PriceEnvelopePanel,
  ProductScatterPanel,
  VwapOverTimePanel,
} from "./panels.js";
import { FreshnessDot, PartialBanner, SourceBadge } from "./StatusBar.js";
import { useDimensions, useHealth, useOverview } from "./useMonitor.js";

function readInitialFilters(): FilterState {
  if (typeof window === "undefined") return DEFAULT_FILTERS;
  return fromSearchParams(window.location.search);
}

export function MonitorDashboard() {
  const [filters, setFilters] = useState<FilterState>(readInitialFilters);

  // Keep the URL in step with the filters so a view can be shared as a link.
  useEffect(() => {
    const query = toSearchParams(filters);
    window.history.replaceState(null, "", query ? `?${query}` : window.location.pathname);
  }, [filters]);

  const localRange = useMemo(() => resolveRange(filters), [filters]);
  const refreshMs = localRange.live && filters.refreshMs > 0 ? filters.refreshMs : null;

  const overview = useOverview(
    () => toQuery(filters, resolveRange(filters)),
    filterKey(filters),
    refreshMs,
  );
  const dimensions = useDimensions(
    () => toQuery(filters, resolveRange(filters), false),
    filterKey(filters, false),
  );
  const health = useHealth();

  const data = overview.data;
  const range = data
    ? { from: new Date(data.range.from), to: new Date(data.range.to), live: localRange.live }
    : localRange;

  const colors = useMemo(
    () => buildCountryColors((dimensions.data?.countries ?? []).map((entry) => entry.country)),
    [dimensions.data],
  );

  const panelProps = data ? { data, colors, dimmed: overview.refreshing } : null;

  return (
    <div className="monitor">
      <header className="monitor__header">
        <div className="monitor__heading">
          <h1 className="monitor__title">Intraday Public Trades — Live Monitor</h1>
          <p className="monitor__caption">
            Last {data?.plan.bufferHours ?? health.data?.bufferHours ?? 48} h from Lakebase Postgres · older
            from Delta (Unity Catalog) · times in CET/CEST
          </p>
        </div>
        <div className="monitor__status">
          <FreshnessDot health={health.data} />
          {data && <SourceBadge plan={data.plan} />}
          <span className="monitor__updated">
            {overview.lastUpdated
              ? `Updated ${formatIsoShort(overview.lastUpdated.toISOString())}`
              : "Loading…"}
          </span>
        </div>
      </header>

      <FilterBar
        value={filters}
        onChange={setFilters}
        range={range}
        dimensions={dimensions.data}
        onRefreshNow={overview.refresh}
        busy={overview.refreshing}
      />

      {overview.error !== null && (
        <div className="banner banner--error" role="alert">
          <strong>Could not load the dashboard.</strong> {overview.error}
        </div>
      )}
      {data && <PartialBanner plan={data.plan} />}

      {overview.loading && data === null ? (
        <p className="monitor__loading">
          Querying {localRange.live ? "the live buffer" : "the Delta history"}…
        </p>
      ) : data === null ? (
        <p className="monitor__loading">No data.</p>
      ) : (
        <>
          <KpiRow kpis={data.kpis} countryCount={data.countries.length} dimmed={overview.refreshing} />

          <div className="monitor__grid">
            <div className="monitor__cell monitor__cell--third">
              <VwapOverTimePanel {...panelProps!} />
            </div>
            <div className="monitor__cell monitor__cell--third">
              <CountryVolumePanel {...panelProps!} />
            </div>
            <div className="monitor__cell monitor__cell--third">
              <DeliveryVwapPanel {...panelProps!} />
            </div>
            <div className="monitor__cell monitor__cell--half">
              <ProductScatterPanel {...panelProps!} />
            </div>
            <div className="monitor__cell monitor__cell--half">
              <PriceEnvelopePanel {...panelProps!} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
