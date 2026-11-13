import { useCallback, useEffect, useRef, useState } from "react";
import { listAdminAnnouncements, type AdminAnnouncement } from "@/lib/adminAnnouncements";

export function useAdminAnnouncements(intervalMs = 5000) {
  const [items, setItems] = useState<AdminAnnouncement[] | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const requestId = useRef(0);

  const refetch = useCallback(async () => {
    const currentRequestId = ++requestId.current;
    try {
      const result = await listAdminAnnouncements();
      if (currentRequestId === requestId.current) {
        setItems(result);
        setError(null);
      }
    } catch (caught) {
      if (currentRequestId === requestId.current) {
        setError(caught instanceof Error ? caught : new Error("Could not load announcements."));
      }
    } finally {
      if (currentRequestId === requestId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refetch();
    const timer = window.setInterval(() => {
      if (!document.hidden) void refetch();
    }, intervalMs);
    return () => {
      requestId.current += 1;
      window.clearInterval(timer);
    };
  }, [intervalMs, refetch]);

  return { items, error, loading, refetch };
}
