import { useEffect, useRef, useState } from "react";
import { getAdminAnalytics, type AdminAnalyticsData } from "@/lib/adminAnalytics";

export function useAdminAnalytics(intervalMs = 5000) {
  const [data, setData] = useState<AdminAnalyticsData | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const requestId = useRef(0);

  useEffect(() => {
    let active = true;
    let requestPending = false;

    const refresh = async () => {
      if (requestPending) return;
      requestPending = true;
      const currentRequestId = ++requestId.current;
      try {
        const result = await getAdminAnalytics();
        if (active && currentRequestId === requestId.current) {
          setData(result);
          setError(null);
        }
      } catch (caught) {
        if (active && currentRequestId === requestId.current) {
          setError(caught instanceof Error ? caught : new Error("Could not load analytics."));
        }
      } finally {
        requestPending = false;
        if (active && currentRequestId === requestId.current) setLoading(false);
      }
    };

    void refresh();
    const timer = window.setInterval(() => {
      if (!document.hidden) void refresh();
    }, intervalMs);
    return () => {
      active = false;
      requestId.current += 1;
      window.clearInterval(timer);
    };
  }, [intervalMs]);

  return { data, error, loading };
}
