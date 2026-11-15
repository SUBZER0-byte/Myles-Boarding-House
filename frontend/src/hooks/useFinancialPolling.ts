import { useCallback, useEffect, useRef, useState } from "react";

export function useFinancialPolling<T>(load: () => Promise<T>, intervalMs = 5000, enabled = true) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const requestId = useRef(0);

  const refetch = useCallback(async () => {
    const currentRequest = ++requestId.current;
    try {
      const result = await load();
      if (currentRequest !== requestId.current) return;
      setData(result);
      setError(null);
    } catch (reason) {
      if (currentRequest !== requestId.current) return;
      setError(reason instanceof Error ? reason.message : "Could not load financial records.");
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }, [load]);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    void refetch();
    const timer = window.setInterval(() => {
      if (!document.hidden) void refetch();
    }, intervalMs);
    return () => {
      requestId.current += 1;
      window.clearInterval(timer);
    };
  }, [enabled, intervalMs, refetch]);

  return { data, error, loading, refetch };
}
