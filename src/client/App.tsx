import { useState } from "react";

import { MonitorDashboard } from "./monitor/MonitorDashboard.js";
import { DiagnosticsSection } from "./sections/DiagnosticsSection.js";

type Tab = "monitor" | "diagnostics";

/**
 * The dashboard is the app. The diagnostics tab keeps the original raw-row
 * panels around — they are the quickest way to confirm both surfaces are
 * reachable when a panel comes back empty.
 */
export function App() {
  const [tab, setTab] = useState<Tab>("monitor");

  return (
    <div className="dashboard-root">
      {tab === "monitor" ? <MonitorDashboard /> : <DiagnosticsSection />}

      <footer className="app-footer">
        <nav className="app-tabs" aria-label="Views">
          <button
            type="button"
            className={`app-tab${tab === "monitor" ? " app-tab--active" : ""}`}
            onClick={() => setTab("monitor")}
            aria-pressed={tab === "monitor"}
          >
            Dashboard
          </button>
          <button
            type="button"
            className={`app-tab${tab === "diagnostics" ? " app-tab--active" : ""}`}
            onClick={() => setTab("diagnostics")}
            aria-pressed={tab === "diagnostics"}
          >
            Diagnostics
          </button>
        </nav>
      </footer>
    </div>
  );
}
