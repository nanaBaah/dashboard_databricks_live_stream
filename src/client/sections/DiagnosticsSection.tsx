/**
 * Connectivity diagnostics for the two surfaces.
 *
 * These are the original raw-row panels: the newest row from Lakebase and from
 * the Unity Catalog table, plus their row counts. They answer "is the pipeline
 * writing at all?" independently of the dashboard's aggregate queries, so they
 * stay one click away. The polling hooks live inside this component, so nothing
 * polls while the dashboard tab is open.
 */

import { useLakebaseTrades } from "../hooks/useLakebaseTrades.js";
import { AnalyticsSection } from "./AnalyticsSection.js";
import { LiveTradesSection } from "./LiveTradesSection.js";

export function DiagnosticsSection() {
  const { trades, count, latest, status, error } = useLakebaseTrades();

  return (
    <div className="diagnostics">
      <header className="monitor__header">
        <div className="monitor__heading">
          <h1 className="monitor__title">Diagnostics</h1>
          <p className="monitor__caption">
            Raw rows straight from each surface — used to confirm both are reachable and writing.
          </p>
        </div>
      </header>

      <AnalyticsSection />
      <LiveTradesSection trades={trades} count={count} latest={latest} status={status} error={error} />
    </div>
  );
}
