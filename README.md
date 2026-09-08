# Telemetry Dashboard (Databricks AppKit)

Node/React/TypeScript **AppKit** app for the Real-Time Telemetry Pipeline —
the live Intraday Public Trades dashboard. The React client polls two JSON
endpoints on a short interval and renders a KPI row plus a recent-trades
table. There is **no SSE** in either direction; long-lived streams proved
unreliable through the Databricks Apps proxy and the Lakebase Autoscaling
cold-start path, so both data sources are exposed as plain polling routes.

AppKit is Databricks' current SDK for Apps (v0.43.0, Node 22+). This project
mirrors what `databricks apps init --features lakebase,analytics` generates.

## Architecture

Three AppKit layers wired in [`src/server/index.ts`](src/server/index.ts):

| Layer  | Piece                        | Purpose |
|--------|------------------------------|---------|
| Data   | `lakebase()` plugin          | Postgres pool (auto OAuth refresh) → reads of `public.trades_latest` |
| Data   | `analytics()` plugin         | Serverless SQL Warehouse executor for the UC table (server-side `appKit.analytics.query`); **no client-side SSE** |
| Server | `server()` plugin            | Express HTTP server, static client serving, Vite dev |
| Client | React (`src/client/`)        | KPI row + recent-trades table; polls the JSON endpoints every 2 s |

## API endpoints

All routes return JSON on every request (short-polled by the client). Custom
routes live in [src/server/lakebase_routes.ts](src/server/lakebase_routes.ts)
(Lakebase Postgres) and [src/server/uc_routes.ts](src/server/uc_routes.ts)
(Unity Catalog via the Serverless SQL Warehouse).

| Route                    | Source        | Notes                                                                   |
|--------------------------|---------------|-------------------------------------------------------------------------|
| `GET /api/trades`        | Lakebase      | `{ trades: LiveTrade[], count: number }` — recent rows + total count    |
| `GET /api/trades/latest` | Lakebase      | Single most-recent row (or `null`)                                      |
| `GET /api/trades/count`  | Lakebase      | `{ count: number }`                                                     |
| `GET /api/uc/latest`     | SQL Warehouse | Latest row from `dev_hysbox.telemetry.kr_intraday_public_trades_live_test` |
| `GET /api/uc/count`      | SQL Warehouse | `{ count: number }` for the same UC table                               |

Client-side polling hooks:
[`useLakebaseTrades`](src/client/hooks/useLakebaseTrades.ts) drives the
Lakebase panel; [`useUcTable`](src/client/hooks/useUcTable.ts) drives the UC
panel. Both use a `setTimeout` loop that is rescheduled after each response,
so a slow request never overlaps the next one, and abort in-flight fetches on
unmount.

## Auth & permissions

The deployed app gets a dedicated **service principal**; Databricks injects its
OAuth credentials at runtime, so no tokens live in code. The service principal
is scoped (least privilege) in the bundle resource
[`resources/apps/telemetry-dashboard-appkit.yaml`](../../../resources/apps/telemetry-dashboard-appkit.yaml):
`SELECT` on Lakebase `trades_latest` / synced tables, `CAN_USE` on the
Serverless SQL Warehouse, and `SELECT` on the UC source table — nothing broader.

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

| Script              | What it does |
|---------------------|--------------|
| `npm run dev`       | Local dev server (client + server, hot reload) |
| `npm run build`     | Production build (client bundle + server) |
| `npm run start`     | Run the built app (the `app.yaml` command in production) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint`      | ESLint |

## Deployment

CI/CD is wired in
[`azure_pipelines/databricks/deploy-telemetry-dashboard-appkit-app.pipeline.yaml`](../../../azure_pipelines/databricks/deploy-telemetry-dashboard-appkit-app.pipeline.yaml):
Node 22 → `npm install` → typecheck → lint → `npm run build` → `databricks bundle deploy`
→ health check. The app is defined declaratively as a bundle resource, so it
deploys with the rest of HySBAP via `databricks bundle deploy`.

> Requires a **Premium** workspace (Databricks Apps) and a **Serverless** SQL
> Warehouse (UC-registered Lakebase reads fail on Pro/Classic).
