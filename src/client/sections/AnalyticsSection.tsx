import { useUcTable } from "../hooks/useUcTable.js";
import type { PollStatus } from "../types.js";
import { formatCell } from "../utils.js";

const TABLE_FQN = "dev_hysbox.telemetry.kr_intraday_public_trades_live_test";

const STATUS_COLOR: Record<PollStatus, string> = {
  live: "green",
  connecting: "goldenrod",
  error: "crimson",
};

function statusLabel(status: PollStatus): string {
  if (status === "live") return "● live";
  if (status === "connecting") return "● loading…";
  return "● error";
}

export function AnalyticsSection() {
  const { latest, count, status, error } = useUcTable();
  const columns = latest ? Object.keys(latest) : [];

  return (
    <main style={{ padding: "1.25rem 1.5rem", overflow: "auto" }}>
      <p style={{ margin: "0 0 0.75rem" }}>
        <strong>Unity Catalog table:</strong> <code>{TABLE_FQN}</code>
        <span
          style={{
            marginLeft: "0.6rem",
            fontSize: "0.75rem",
            fontWeight: "normal",
            color: STATUS_COLOR[status],
          }}
        >
          {statusLabel(status)}
        </span>
      </p>

      {error && (
        <div
          role="alert"
          style={{
            padding: "0.5rem 0.75rem",
            border: "1px solid crimson",
            borderRadius: 6,
            color: "crimson",
            marginBottom: "0.75rem",
            fontSize: "0.85rem",
          }}
        >
          {error}
        </div>
      )}

      <p style={{ fontSize: "1.1rem", margin: "0 0 1rem" }}>
        <strong>COUNT(*):</strong>{" "}
        <span style={{ fontVariantNumeric: "tabular-nums" }}>
          {count === null ? "—" : count.toLocaleString()}
        </span>
      </p>

      <h2 style={{ margin: "0.5rem 0 0.5rem", fontSize: "1rem" }}>
        Most recent row (ORDER BY ingestion_timestamp DESC LIMIT 1)
      </h2>

      {!latest ? (
        <p style={{ color: "var(--ink-3)", fontSize: "0.85rem" }}>
          {status === "connecting" ? "Loading…" : "(no rows)"}
        </p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", fontSize: "0.85rem", minWidth: "100%" }}>
            <thead>
              <tr>
                {columns.map((c) => (
                  <th
                    key={c}
                    style={{
                      textAlign: "left",
                      padding: "0.4rem 0.6rem",
                      borderBottom: "2px solid var(--line)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {columns.map((c) => (
                  <td
                    key={c}
                    style={{
                      padding: "0.35rem 0.6rem",
                      borderBottom: "1px solid var(--line)",
                      whiteSpace: "nowrap",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {formatCell(latest[c])}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
