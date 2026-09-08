/**
 * Panel card: title, subtitle, and a chart/table toggle.
 *
 * Every chart ships a table-view twin — the WCAG-clean equivalent — so no value
 * is reachable only by hovering a coloured mark.
 */

import { useId, useState, type ReactNode } from "react";

export interface PanelTable {
  columns: string[];
  rows: string[][];
  /** Columns to right-align, by index. Defaults to every column but the first. */
  numericFrom?: number;
}

export interface PanelProps {
  title: string;
  subtitle?: ReactNode;
  table: PanelTable;
  children: ReactNode;
  /** Dim the body while a refresh is in flight, instead of flashing a skeleton. */
  dimmed?: boolean;
  className?: string;
}

const MAX_TABLE_ROWS = 200;

export function Panel({ title, subtitle, table, children, dimmed = false, className }: PanelProps) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const titleId = useId();
  const numericFrom = table.numericFrom ?? 1;

  return (
    <section className={`panel${className ? ` ${className}` : ""}`} aria-labelledby={titleId}>
      <header className="panel__header">
        <div>
          <h2 className="panel__title" id={titleId}>
            {title}
          </h2>
          {subtitle !== undefined && <p className="panel__subtitle">{subtitle}</p>}
        </div>
        <div className="panel__views" role="group" aria-label={`${title} view`}>
          <button
            type="button"
            className={`panel__view-btn${view === "chart" ? " panel__view-btn--active" : ""}`}
            onClick={() => setView("chart")}
            aria-pressed={view === "chart"}
          >
            Chart
          </button>
          <button
            type="button"
            className={`panel__view-btn${view === "table" ? " panel__view-btn--active" : ""}`}
            onClick={() => setView("table")}
            aria-pressed={view === "table"}
          >
            Table
          </button>
        </div>
      </header>

      <div className={`panel__body${dimmed ? " panel__body--dimmed" : ""}`}>
        {view === "chart" ? (
          children
        ) : (
          <div className="panel__table-wrap">
            <table className="panel__table">
              <thead>
                <tr>
                  {table.columns.map((column, index) => (
                    <th key={column} scope="col" className={index >= numericFrom ? "panel__td--num" : undefined}>
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.slice(0, MAX_TABLE_ROWS).map((row, rowIndex) => (
                  <tr key={`${row[0] ?? rowIndex}-${rowIndex}`}>
                    {row.map((cell, index) => (
                      <td
                        key={`${index}-${cell}`}
                        className={index >= numericFrom ? "panel__td--num" : undefined}
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
                {table.rows.length === 0 && (
                  <tr>
                    <td colSpan={table.columns.length} className="panel__table-empty">
                      No rows in this slice.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            {table.rows.length > MAX_TABLE_ROWS && (
              <p className="panel__table-note">
                Showing the first {MAX_TABLE_ROWS} of {table.rows.length.toLocaleString()} rows.
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
