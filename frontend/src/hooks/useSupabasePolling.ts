import { useCallback, useEffect, useRef, useState } from "react";

export function useSupabasePolling<T>(
  load: () => Promise<T>,
  intervalMs = 5000,
  enabled = true,
) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(false);
  const requestId = useRef(0);

  const refetch = useCallback(async () => {
    if (!enabled) return;
    const currentRequest = ++requestId.current;
    try {
      const next = await load();
      if (!mounted.current || currentRequest !== requestId.current) return;
      setData(next);
      setError(null);
    } catch (cause) {
      if (!mounted.current || currentRequest !== requestId.current) return;
      setError(cause instanceof Error ? cause.message : "Could not load data.");
    } finally {
      if (mounted.current && currentRequest === requestId.current) setLoading(false);
    }
  }, [enabled, load]);

  useEffect(() => {
    mounted.current = true;
    if (!enabled) {
      setLoading(false);
      return () => { mounted.current = false; };
    }

    void refetch();
    const timer = window.setInterval(() => {
      if (!document.hidden) void refetch();
    }, intervalMs);
    return () => {
      mounted.current = false;
      requestId.current += 1;
      window.clearInterval(timer);
    };
  }, [enabled, intervalMs, refetch]);

  return { data, loading, error, refetch };
}
