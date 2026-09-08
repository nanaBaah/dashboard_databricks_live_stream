# Intraday Public Trades — Live Monitor (Databricks AppKit)

Node/React/TypeScript **AppKit** app for the Real-Time Telemetry Pipeline. The
dashboard reads the *same logical trades table from two engines* and decides,
from the traded time range alone, which one answers:

| Traded time range | Source | Why |
|---|---|---|
| Inside the last 48 h | **Lakebase Postgres** `public.trades_latest` | The live FIFO buffer — sub-second aggregate scans, refreshed on a timer |
| Older than 48 h | **Delta / Unity Catalog** via a Serverless SQL Warehouse | The complete, append-only history |
| Straddling the boundary | **Both**, split and merged | Delta answers `[from, boundary)`, Lakebase `[boundary, to)` |

The split is half-open on both sides, so a trade is counted exactly once even
though Delta also holds the last 48 h. Which engines actually answered is shown
in the header, next to the freshness dot.

> **Why partial aggregates.** Every panel query returns only additive values —
> `COUNT(*)`, `SUM(volume)`, `SUM(price*volume)`, `SUM(price)`, `COUNT(price)`,
> `MIN`, `MAX` — never a ratio. VWAP and average price are derived *after* the
> two sources are merged, so a hybrid range produces exactly the numbers one
> engine would have produced for the whole range. Averaging two per-source
> VWAPs would weight a 30-day history and a 47-hour buffer equally.
> `npm test` asserts this.

There is **no SSE** in either direction; long-lived streams proved unreliable
through the Databricks Apps proxy and the Lakebase Autoscaling cold-start path,
so both surfaces are exposed as plain polling routes.

## The dashboard

One filter row (traded time range, country, product type, side, auto-refresh)
scopes everything below it:

- **Trade count · VWAP · Total volume** — headline tiles for the slice.
- **VWAP over time** — volume-weighted price by execution time.
- **Volume share by country** — donut, top 5 countries plus `Other`.
- **VWAP by country** — one line per top country, by delivery period.
- **Avg price vs volume by contract** — one mark per delivery contract and side.
- **Price range by delivery period** — VWAP inside the min–max envelope.

Every panel has a **Table** toggle carrying the same values, filter state
round-trips through the URL (so a view is a shareable link), and a failed
source raises a "partial results" banner rather than silently showing a
fraction of the range.

The derived `country` and `product type` dimensions mirror the Databricks
dataset one-for-one — country from the EIC prefix of `product_key`
(`^10Y(XX)`, then `^(XX)-`, else `Other`), product type from the delivery span
in whole minutes (`15 min`, `60 min`, …).

## Architecture

Wired in [`src/server/index.ts`](src/server/index.ts):

| Layer  | Piece                        | Purpose |
|--------|------------------------------|---------|
| Data   | `lakebase()` plugin          | Postgres pool (auto OAuth refresh) → the live 48 h buffer |
| Data   | `analytics()` plugin         | Serverless SQL Warehouse executor for the UC history (server-side `appKit.analytics.query`) |
| Server | `server()` plugin            | Express HTTP server, static client serving, Vite dev |
| Client | React (`src/client/`)        | Dashboard shell, filter bar, and dependency-free SVG charts |

Server modules, in the order a request flows through them:

| File | Role |
|---|---|
| [`monitor/params.ts`](src/server/monitor/params.ts) | Parse + validate filters (422, never a 500) |
| [`monitor/plan.ts`](src/server/monitor/plan.ts) | Route the traded range across the buffer boundary |
| [`monitor/queries_pg.ts`](src/server/monitor/queries_pg.ts) · [`queries_delta.ts`](src/server/monitor/queries_delta.ts) | The same five queries in each dialect, on one epoch-anchored bucket grid |
| [`monitor/sources.ts`](src/server/monitor/sources.ts) | Execute a window, normalise rows, isolate failures |
| [`monitor/aggregate.ts`](src/server/monitor/aggregate.ts) | Merge partial aggregates, derive the ratios |
| [`monitor/overview.ts`](src/server/monitor/overview.ts) | Shape the panel payload |

Filters are always **bound as SQL parameters**; only validated identifiers and
whitelisted integers (bucket widths, limits) are interpolated.

## API endpoints

| Route | Source | Notes |
|---|---|---|
| `GET /api/monitor/overview` | routed | KPIs + all five panels for one filter set |
| `GET /api/monitor/dimensions` | routed | Filter options for a traded range; also fixes each country's colour |
| `GET /api/monitor/health` | Lakebase (+ cached Delta) | Freshness, row counts, thresholds |
| `GET /api/trades[/latest\|/count]` | Lakebase | Raw rows — the Diagnostics tab |
| `GET /api/uc/latest`, `/api/uc/count` | SQL Warehouse | Raw rows — the Diagnostics tab |

Query parameters for the first two: `from`, `to` (ISO), `country`,
`productType`, `side`, `bucket` (`auto` or a whitelisted width in seconds).

## Configuration

All set in [`app.yaml`](app.yaml); every one has a default, and an invalid
value fails at boot rather than producing a broken query.

| Variable | Default | Meaning |
|---|---|---|
| `TELEMETRY_SCHEMA` / `LAKEBASE_TABLE` | `public` / `trades_latest` | Live buffer table |
| `UC_TABLE` | `dev_hysbox.telemetry.kr_intraday_public_trades_live_test` | Delta history table |
| `LAKEBASE_BUFFER_HOURS` | `48` | Size of the FIFO buffer |
| `LAKEBASE_BUFFER_SAFETY_MINUTES` | `60` | Margin shaved off the buffer edge before routing to Postgres |
| `FRESHNESS_LAGGING_SECONDS` / `FRESHNESS_STALE_SECONDS` | `30` / `120` | Header dot thresholds |
| `MONITOR_MAX_RANGE_DAYS` | `90` | Widest accepted traded range |
| `LAKEBASE_STATEMENT_TIMEOUT_MS` | `20000` | Postgres statement timeout |
| `DELTA_STATEMENT_TIMEOUT_MS` | `120000` | Warehouse statement timeout (generous: covers a cold start) |

`LAKEBASE_BUFFER_SAFETY_MINUTES` exists because eviction keys on
`ingestion_timestamp` while the dashboard filters on `traded_ts`. A trade is
always ingested at or after execution, so anything with
`traded_ts >= now - (BUFFER_HOURS - margin)` cannot yet have been evicted;
anything older is served from Delta, which holds it either way.

## Auth & permissions

The deployed app gets a dedicated **service principal**; Databricks injects its
OAuth credentials at runtime, so no tokens live in code. It is scoped to
`SELECT` on Lakebase `trades_latest`, `CAN_USE` on the Serverless SQL
Warehouse, and `SELECT` on the UC source table — nothing broader.

## Local development

Prerequisites: Node 22+, Databricks CLI v1.0.0+ with an authenticated profile.

```bash
npm install
cp .env.example .env   # fill in LAKEBASE_ENDPOINT / DATABRICKS_WAREHOUSE_ID
npm run dev            # Vite client + AppKit server with hot reload
```

Local reads use your Databricks user identity via OAuth. Deploy the app once
first so the Lakebase schema/tables exist (the service principal owns them).

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Local dev server (client + server, hot reload) |
| `npm test` | Routing, merge-maths and SQL-shape assertions (tsx + `node:assert`) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run build:app` | Rebuild both bundles (`client_bundle/` + `server_bundle/`) |
| `npm start` | Run the built app (the `app.yaml` command in production) |

The app ships **pre-built**: `client_bundle/` and `server_bundle/` are committed
and uploaded with the source, so the Apps runtime never builds. **Rebuild and
commit both bundles whenever you change `src/`** — otherwise the deployed app
keeps serving the old code.

## Deployment

CI/CD is wired in
[`azure_pipelines/databricks/deploy-telemetry-dashboard-appkit-app.pipeline.yaml`](../../../azure_pipelines/databricks/deploy-telemetry-dashboard-appkit-app.pipeline.yaml):
Node 22 → `npm install` → typecheck → lint → `npm run build` → `databricks bundle deploy`
→ health check. The app is defined declaratively as a bundle resource, so it
deploys with the rest of HySBAP via `databricks bundle deploy`.

> Requires a **Premium** workspace (Databricks Apps) and a **Serverless** SQL
> Warehouse (UC-registered Lakebase reads fail on Pro/Classic).
