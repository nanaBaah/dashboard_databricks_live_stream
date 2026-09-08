/**
 * Polling hooks for the monitor endpoints.
 *
 * A `setTimeout` loop rescheduled *after* each response (never `setInterval`),
 * so a slow warehouse query can't stack requests. The previous payload is kept
 * while a refresh is in flight — panels dim slightly instead of collapsing to
 * skeletons and jumping the layout.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import type { DimensionsResponse, HealthResponse, OverviewResponse } from "../../../shared/monitor_contract.js";

export interface PolledState<T> {
  data: T | null;
  error: string | null;
  /** True until the first successful response. */
  loading: boolean;
  /** True while a refresh is in flight and previous data is still shown. */
  refreshing: boolean;
  lastUpdated: Date | null;
  /** Fetch immediately, outside the poll schedule. */
  refresh: () => void;
}

/**
 * @param makeUrl  built at fetch time, so a live range gets a fresh `to`
 * @param key      changes only when a new fetch series is needed
 * @param intervalMs  `null` or `0` polls once and stops
 */
function usePolledJson<T>(makeUrl: () => string, key: string, intervalMs: number | null): PolledState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const makeUrlRef = useRef(makeUrl);
  makeUrlRef.current = makeUrl;

  const cancelledRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const runRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    cancelledRef.current = false;
    // Deliberately no `setData(null)` here: when the filters change (new `key`)
    // or the refresh interval changes, the previous render is held at reduced
    // opacity until the next payload lands, rather than collapsing to a
    // skeleton and jumping the layout.

    async function poll(): Promise<void> {
      if (cancelledRef.current) return;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setRefreshing(true);

      try {
        const response = await fetch(makeUrlRef.current(), {
          signal: controller.signal,
          headers: { accept: "application/json" },
        });
        if (!response.ok) {
          const body = await response.text().catch(() => "");
          let message = body || response.statusText;
          try {
            const parsed = JSON.parse(body) as { error?: string };
            if (parsed.error) message = parsed.error;
          } catch {
            // Not JSON — keep the raw body.
          }
          throw new Error(`HTTP ${response.status}: ${message}`);
        }
        const body = (await response.json()) as T;
        if (cancelledRef.current) return;
        setData(body);
        setError(null);
        setLastUpdated(new Date());
      } catch (err) {
        if (cancelledRef.current) return;
        // An AbortError just means a newer request pre-empted this one.
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelledRef.current) {
          setLoading(false);
          setRefreshing(false);
          if (intervalMs !== null && intervalMs > 0) {
            timerRef.current = setTimeout(() => void poll(), intervalMs);
          }
        }
      }
    }

    runRef.current = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      void poll();
    };
    void poll();

    return () => {
      cancelledRef.current = true;
      runRef.current = null;
      if (timerRef.current) clearTimeout(timerRef.current);
      abortRef.current?.abort();
    };
  }, [key, intervalMs]);

  const refresh = useCallback(() => runRef.current?.(), []);

  return { data, error, loading, refreshing, lastUpdated, refresh };
}

export function useOverview(
  makeQuery: () => string,
  key: string,
  intervalMs: number | null,
): PolledState<OverviewResponse> {
  return usePolledJson<OverviewResponse>(() => `/api/monitor/overview?${makeQuery()}`, key, intervalMs);
}

/**
 * Filter options. Polled far more slowly than the panels: the option list only
 * shifts as the range slides, and this is what pins each country's colour.
 */
export function useDimensions(makeQuery: () => string, key: string): PolledState<DimensionsResponse> {
  return usePolledJson<DimensionsResponse>(() => `/api/monitor/dimensions?${makeQuery()}`, key, 300_000);
}

export function useHealth(intervalMs = 10_000): PolledState<HealthResponse> {
  return usePolledJson<HealthResponse>(() => "/api/monitor/health", "health", intervalMs);
}
