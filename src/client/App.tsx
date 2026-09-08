import { useLakebaseTrades } from "./hooks/useLakebaseTrades.js";
import { AnalyticsSection } from "./sections/AnalyticsSection.js";
import { LiveTradesSection } from "./sections/LiveTradesSection.js";

export function App() {
  const { trades, count, latest, status, error } = useLakebaseTrades();

  return (
    <div className="dashboard-root">
      <header className="dashboard-header">
        <h1 className="dashboard-header-title">Telemetry Dashboard</h1>
      </header>

      <AnalyticsSection />
      <LiveTradesSection
        trades={trades}
        count={count}
        latest={latest}
        status={status}
        error={error}
      />
    </div>
  );
}
