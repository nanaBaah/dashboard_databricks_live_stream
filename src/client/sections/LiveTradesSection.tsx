import type { LiveTrade, PollStatus } from "../types.js";
import { formatCell } from "../utils.js";

const TRADE_COLS = [
  "trade_id",
  "product_key",
  "eic",
  "side",
  "price_eur_mwh",
  "volume_mw",
  "currency",
  "traded_ts",
  "ingestion_timestamp",
] as const;

type TradeCol = (typeof TRADE_COLS)[number];

const STATUS_COLOR: Record<PollStatus, string> = {
  live: "green",
  connecting: "goldenrod",
  error: "crimson",
};

function statusLabel(status: PollStatus): string {
  if (status === "live") return "● live";
  if (status === "connecting") return "● connecting…";
  return "● error";
}

interface Props {
  trades: LiveTrade[];
  count: number | null;
  latest: LiveTrade | null;
  status: PollStatus;
  error: string | null;
  /** Fully-qualified Lakebase table name shown in the header. */
  tableName?: string;
}

export function LiveTradesSection({
  trades,
  count,
  latest,
  status,
  error,
  tableName = "public.trades_latest",
}: Props) {
  return (
    <section style={{ padding: "0 1.5rem 1.5rem" }}>
      <h2 style={{ margin: "0 0 0.5rem", fontSize: "1rem" }}>
        Lakebase — <code>{tableName}</code>
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
      </h2>

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

      {/* ── KPI row ────────────────────────────────────────── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: "0.75rem",
          margin: "0.5rem 0 1rem",
        }}
      >
        <KpiCard label="Total rows (Lakebase)" value={count === null ? "—" : count.toLocaleString()} />
        <KpiCard label="Rows shown" value={trades.length.toLocaleString()} />
        <KpiCard label="Latest ingestion" value={latest ? formatCell(latest.ingestion_timestamp) : "—"} />
      </div>

      {/* ── Recent-trades table ────────────────────────────── */}
      {trades.length === 0 ? (
        <p style={{ color: "var(--ink-3)", fontSize: "0.85rem" }}>
          {status === "connecting" ? "Loading trades…" : "No trades in the current window."}
        </p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", fontSize: "0.8rem", minWidth: "100%" }}>
            <thead>
              <tr>
                {TRADE_COLS.map((col) => (
                  <th
                    key={col}
                    style={{
                      textAlign: "left",
                      padding: "0.35rem 0.6rem",
                      borderBottom: "2px solid var(--line)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {trades.map((t) => (
                <tr key={t.trade_id}>
                  {TRADE_COLS.map((col) => (
                    <td
                      key={col}
                      style={{
                        padding: "0.3rem 0.6rem",
                        borderBottom: "1px solid var(--line)",
                        whiteSpace: "nowrap",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {formatCell(t[col as TradeCol])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        padding: "0.75rem 1rem",
        border: "1px solid var(--line)",
        borderRadius: 8,
        background: "var(--panel)",
      }}
    >
      <div
        style={{
          fontSize: "0.7rem",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          color: "var(--ink-3)",
          marginBottom: "0.25rem",
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: "1.25rem", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
        {value}
      </div>
    </div>
  );
}
