import { useEffect, useRef, useState, useCallback } from "react";
import { api, type ApiResponse } from "@/lib/api";
import type { AxiosRequestConfig } from "axios";

interface UsePollingOptions {
  /** Polling interval in ms. Default is 5000. */
  intervalMs?: number;
  /** Disable entirely (still does one initial fetch). */
  enabled?: boolean;
  /** Keep old callers compatible without enabling any websocket behavior. */
  alwaysPoll?: boolean;
  pauseWhenHidden?: boolean;
  config?: AxiosRequestConfig;
}

/**
 * AJAX polling data hook.
 * This performs regular HTTP refreshes every few seconds without any
 * websocket client setup.
 */
export function usePolling<T = unknown>(
  url: string | null,
  {
    intervalMs = 5000,
    enabled = true,
    alwaysPoll = false,
    pauseWhenHidden = true,
    config,
  }: UsePollingOptions = {}
) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(!!url);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const aliveRef = useRef(true);
  const requestIdRef = useRef(0);

  const fetchOnce = useCallback(async () => {
    if (!url) return;
    const requestId = ++requestIdRef.current;
    try {
      const res = await api.get<ApiResponse<T>>(url, config);
      if (!aliveRef.current || requestId !== requestIdRef.current) return;
      if (res.data?.type === "success") {
        setData((Object.prototype.hasOwnProperty.call(res.data, "data") ? res.data.data : res.data) as T);
        setError(null);
        setLastUpdated(new Date());
      } else {
        setError(res.data?.message || "Request failed");
      }
    } catch (e: unknown) {
      if (!aliveRef.current || requestId !== requestIdRef.current) return;
      const msg = e instanceof Error ? e.message : "Network error";
      setError(msg);
    } finally {
      if (aliveRef.current && requestId === requestIdRef.current) setLoading(false);
    }
  }, [url, JSON.stringify(config)]);

  useEffect(() => {
    aliveRef.current = true;
    if (!url || !enabled) return;

    void fetchOnce();

    const id = window.setInterval(() => {
      if (pauseWhenHidden && document.hidden) return;
      void fetchOnce();
    }, intervalMs);

    return () => {
      aliveRef.current = false;
      requestIdRef.current += 1;
      window.clearInterval(id);
    };
  }, [url, enabled, alwaysPoll, intervalMs, pauseWhenHidden, fetchOnce]);

  return { data, loading, error, refetch: fetchOnce, lastUpdated };
}
