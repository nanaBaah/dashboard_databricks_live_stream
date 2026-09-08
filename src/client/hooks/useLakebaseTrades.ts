import { useEffect, useRef, useState } from "react";

import type { LiveTrade, PollStatus } from "../types.js";

/** Response shape of `GET /api/trades`. */
interface TradesResponse {
  trades: LiveTrade[];
  count: number;
}

export interface LakebaseTradesState {
  /** Most recent rows (newest first), up to `limit`. */
  trades: LiveTrade[];
  /** Total row count of `public.trades_latest` (48 h rolling window). */
  count: number | null;
  /** Convenience shortcut — `trades[0]`. */
  latest: LiveTrade | null;
  /** Poll status shown as an indicator dot in the UI. */
  status: PollStatus;
  /** Last error message from the server, if any. */
  error: string | null;
}

/**
 * Polls `GET /api/trades` every `intervalMs` ms and returns the latest snapshot.
 *
 * Simple `setTimeout` loop (rescheduled after each response) so a slow request
 * never causes overlapping fetches. Aborts the in-flight request on unmount.
 */
export function useLakebaseTrades(
  intervalMs = 2_000,
  limit = 10,
): LakebaseTradesState {
  const [trades, setTrades] = useState<LiveTrade[]>([]);
  const [count, setCount] = useState<number | null>(null);
  const [status, setStatus] = useState<PollStatus>("connecting");
  const [error, setError] = useState<string | null>(null);

  const cancelledRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    cancelledRef.current = false;

    async function poll(): Promise<void> {
      if (cancelledRef.current) return;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch(`/api/trades?limit=${encodeURIComponent(limit)}`, {
          signal: controller.signal,
          headers: { accept: "application/json" },
        });
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          throw new Error(`HTTP ${res.status}: ${body || res.statusText}`);
        }
        const body = (await res.json()) as TradesResponse;
        if (cancelledRef.current) return;
        setTrades(body.trades ?? []);
        setCount(typeof body.count === "number" ? body.count : null);
        setStatus("live");
        setError(null);
      } catch (err) {
        if (cancelledRef.current) return;
        // AbortError just means the next poll pre-empted this one; ignore.
        if (err instanceof DOMException && err.name === "AbortError") return;
        setStatus("error");
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelledRef.current) {
          timerRef.current = setTimeout(() => {
            void poll();
          }, intervalMs);
        }
      }
    }

    void poll();

    return () => {
      cancelledRef.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      abortRef.current?.abort();
    };
  }, [intervalMs, limit]);

  return { trades, count, latest: trades[0] ?? null, status, error };
}
