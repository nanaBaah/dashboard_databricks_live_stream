import { useEffect, useRef, useState } from "react";

import type { PollStatus } from "../types.js";

/** Response shape of `GET /api/uc/count`. */
interface UcCountResponse {
  count: number;
}

/** A single UC row — schema is dynamic so we keep it fully typed as `unknown`. */
export type UcRow = Record<string, unknown>;

export interface UcTableState {
  /** Latest UC row, or null when the table is empty. */
  latest: UcRow | null;
  /** Total row count of the UC table. */
  count: number | null;
  /** Poll status shown as an indicator dot in the UI. */
  status: PollStatus;
  /** Last error message from the server, if any. */
  error: string | null;
}

/**
 * Polls `GET /api/uc/latest` and `GET /api/uc/count` every `intervalMs`.
 *
 * Both requests are issued in parallel; failure of one does not fail the other.
 * Uses `setTimeout` (rescheduled after each round-trip) so slow warehouse
 * responses do not cause overlapping requests.
 */
export function useUcTable(intervalMs = 2_000): UcTableState {
  const [latest, setLatest] = useState<UcRow | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const [status, setStatus] = useState<PollStatus>("connecting");
  const [error, setError] = useState<string | null>(null);

  const cancelledRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    cancelledRef.current = false;

    async function fetchLatest(signal: AbortSignal): Promise<UcRow | null> {
      const res = await fetch("/api/uc/latest", { signal, headers: { accept: "application/json" } });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`/api/uc/latest HTTP ${res.status}: ${body || res.statusText}`);
      }
      return (await res.json()) as UcRow | null;
    }

    async function fetchCount(signal: AbortSignal): Promise<number> {
      const res = await fetch("/api/uc/count", { signal, headers: { accept: "application/json" } });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`/api/uc/count HTTP ${res.status}: ${body || res.statusText}`);
      }
      const body = (await res.json()) as UcCountResponse;
      return body.count;
    }

    async function poll(): Promise<void> {
      if (cancelledRef.current) return;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      // Parallelise the two independent requests; use allSettled so a warehouse
      // hiccup on one endpoint doesn't blank the whole panel.
      const [latestRes, countRes] = await Promise.allSettled([
        fetchLatest(controller.signal),
        fetchCount(controller.signal),
      ]);
      if (cancelledRef.current) return;

      let anyError: string | null = null;

      if (latestRes.status === "fulfilled") {
        setLatest(latestRes.value);
      } else if (!(latestRes.reason instanceof DOMException && latestRes.reason.name === "AbortError")) {
        anyError = latestRes.reason instanceof Error ? latestRes.reason.message : String(latestRes.reason);
      }

      if (countRes.status === "fulfilled") {
        setCount(countRes.value);
      } else if (!(countRes.reason instanceof DOMException && countRes.reason.name === "AbortError")) {
        anyError = countRes.reason instanceof Error ? countRes.reason.message : String(countRes.reason);
      }

      if (anyError !== null) {
        setStatus("error");
        setError(anyError);
      } else {
        setStatus("live");
        setError(null);
      }

      if (!cancelledRef.current) {
        timerRef.current = setTimeout(() => {
          void poll();
        }, intervalMs);
      }
    }

    void poll();

    return () => {
      cancelledRef.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      abortRef.current?.abort();
    };
  }, [intervalMs]);

  return { latest, count, status, error };
}
