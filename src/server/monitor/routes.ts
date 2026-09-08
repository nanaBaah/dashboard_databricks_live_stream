/**
 * HTTP routes for the Intraday Public Trades - Live Monitor.
 *
 *   GET /api/monitor/overview    KPIs + every panel, for one filter set
 *   GET /api/monitor/dimensions  filter-dropdown options for a traded range
 *   GET /api/monitor/health      pipeline freshness (Story 4.4)
 *
 * Each request is routed across the Lakebase/Delta boundary by `plan.ts`; the
 * response always reports which engines answered, so the split is visible in
 * the UI instead of being a hidden implementation detail.
 */

import type { Application, Request, Response } from "express";

import type { DimensionsResponse, HealthResponse, HealthStatus } from "../../../shared/monitor_contract.js";
import {
  BUFFER_HOURS,
  FRESHNESS_LAGGING_SECONDS,
  FRESHNESS_STALE_SECONDS,
  LAKEBASE_FQN,
  UC_TABLE,
} from "../config.js";
import { buildOverview, toPlanWire } from "./overview.js";
import { InvalidRequestError, parseFilters } from "./params.js";
import { planSources } from "./plan.js";
import {
  fetchDeltaFreshness,
  fetchDimensionsWindow,
  fetchLakebaseFreshness,
  type SourceDeps,
} from "./sources.js";

/** Delta freshness costs a warehouse statement, so it is cached between polls. */
const DELTA_FRESHNESS_TTL_MS = 60_000;

let deltaFreshnessCache: {
  at: number;
  value: { lastIngestion: string | null; ageSeconds: number | null };
  error: string | null;
} | null = null;

function sendError(res: Response, err: unknown, context: string): void {
  if (err instanceof InvalidRequestError) {
    res.status(422).json({ error: err.message });
    return;
  }
  console.error(`[${context}] failed:`, err);
  if (!res.headersSent) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
}

async function deltaFreshness(
  deps: SourceDeps,
): Promise<{ lastIngestion: string | null; ageSeconds: number | null; error: string | null }> {
  const now = Date.now();
  if (deltaFreshnessCache && now - deltaFreshnessCache.at < DELTA_FRESHNESS_TTL_MS) {
    return { ...deltaFreshnessCache.value, error: deltaFreshnessCache.error };
  }
  try {
    const value = await fetchDeltaFreshness(deps.analytics);
    deltaFreshnessCache = { at: now, value, error: null };
    return { ...value, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    deltaFreshnessCache = { at: now, value: { lastIngestion: null, ageSeconds: null }, error: message };
    return { lastIngestion: null, ageSeconds: null, error: message };
  }
}

function healthStatus(freshnessSeconds: number | null, reachable: boolean): HealthStatus {
  if (!reachable) return "stale";
  if (freshnessSeconds === null) return "unknown";
  if (freshnessSeconds > FRESHNESS_STALE_SECONDS) return "stale";
  if (freshnessSeconds > FRESHNESS_LAGGING_SECONDS) return "lagging";
  return "ok";
}

export function registerMonitorRoutes(app: Application, deps: SourceDeps): void {
  // Every panel for one filter set, merged across whichever engines the plan picked.
  app.get("/api/monitor/overview", (req: Request, res: Response) => {
    void (async () => {
      try {
        const now = new Date();
        const filters = parseFilters(req.query as Record<string, unknown>, now);
        const plan = planSources(filters, now);
        res.json(await buildOverview(deps, plan, filters));
      } catch (err) {
        sendError(res, err, "api/monitor/overview");
      }
    })();
  });

  // Filter options. Only the traded range applies, so choosing a country never
  // empties the country list, and the ranking here is what fixes each country's
  // colour for the session.
  app.get("/api/monitor/dimensions", (req: Request, res: Response) => {
    void (async () => {
      try {
        const now = new Date();
        const filters = parseFilters(req.query as Record<string, unknown>, now);
        const plan = planSources(filters, now);

        const results = await Promise.all(plan.windows.map((w) => fetchDimensionsWindow(deps, w)));

        const countries = new Map<string, { trades: number; volume: number }>();
        const productTypes = new Map<string, { trades: number; volume: number }>();
        for (const { rows } of results) {
          for (const row of rows) {
            const country = countries.get(row.country) ?? { trades: 0, volume: 0 };
            country.trades += row.trades;
            country.volume += row.volume;
            countries.set(row.country, country);

            const productType = productTypes.get(row.product_type) ?? { trades: 0, volume: 0 };
            productType.trades += row.trades;
            productType.volume += row.volume;
            productTypes.set(row.product_type, productType);
          }
        }

        const body: DimensionsResponse = {
          range: { from: filters.from.toISOString(), to: filters.to.toISOString() },
          plan: toPlanWire(
            plan,
            results.map((r) => r.stats),
          ),
          countries: [...countries.entries()]
            .map(([country, agg]) => ({ country, ...agg }))
            .sort((a, b) => b.volume - a.volume || a.country.localeCompare(b.country)),
          productTypes: [...productTypes.entries()]
            .map(([productType, agg]) => ({ productType, ...agg }))
            .sort((a, b) => b.volume - a.volume || a.productType.localeCompare(b.productType)),
        };
        res.json(body);
      } catch (err) {
        sendError(res, err, "api/monitor/dimensions");
      }
    })();
  });

  // Pipeline freshness for the header dot.
  app.get("/api/monitor/health", (_req: Request, res: Response) => {
    void (async () => {
      try {
        const [lakebase, delta] = await Promise.all([
          fetchLakebaseFreshness(deps.pool).then(
            (value) => ({ value, error: null as string | null }),
            (err: unknown) => ({ value: null, error: err instanceof Error ? err.message : String(err) }),
          ),
          deltaFreshness(deps),
        ]);

        const body: HealthResponse = {
          status: healthStatus(lakebase.value?.ingestionAgeSeconds ?? null, lakebase.value !== null),
          lakebase: {
            reachable: lakebase.value !== null,
            lastIngestion: lakebase.value?.lastIngestion ?? null,
            lastTraded: lakebase.value?.lastTraded ?? null,
            freshnessSeconds: lakebase.value?.ingestionAgeSeconds ?? null,
            tradedLagSeconds: lakebase.value?.tradedAgeSeconds ?? null,
            rows1m: lakebase.value?.rows1m ?? 0,
            rows5m: lakebase.value?.rows5m ?? 0,
            rows1h: lakebase.value?.rows1h ?? 0,
            error: lakebase.error,
          },
          delta: {
            reachable: delta.error === null,
            lastIngestion: delta.lastIngestion,
            freshnessSeconds: delta.ageSeconds,
            error: delta.error,
          },
          thresholds: {
            laggingSeconds: FRESHNESS_LAGGING_SECONDS,
            staleSeconds: FRESHNESS_STALE_SECONDS,
          },
          bufferHours: BUFFER_HOURS,
        };
        res.json(body);
      } catch (err) {
        sendError(res, err, "api/monitor/health");
      }
    })();
  });

  console.log(
    `[startup] Monitor routes registered: /api/monitor/{overview,dimensions,health} ` +
      `(live=${LAKEBASE_FQN} <=${BUFFER_HOURS}h, history=${UC_TABLE})`,
  );
}
