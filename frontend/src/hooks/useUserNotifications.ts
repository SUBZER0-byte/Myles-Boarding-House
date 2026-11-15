import { useCallback, useEffect, useRef, useState } from "react";
import {
  getUserUnreadNotificationCount,
  listUserNotifications,
  type UserNotification,
} from "@/lib/userNotifications";

function toError(caught: unknown): Error {
  return caught instanceof Error ? caught : new Error("Could not load notifications.");
}

export function useUserNotifications(intervalMs = 5000) {
  const [notifications, setNotifications] = useState<UserNotification[] | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const requestId = useRef(0);

  const refetch = useCallback(async () => {
    const currentRequestId = ++requestId.current;
    try {
      const result = await listUserNotifications();
      if (currentRequestId === requestId.current) {
        setNotifications(result);
        setError(null);
      }
    } catch (caught) {
      if (currentRequestId === requestId.current) setError(toError(caught));
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

  return { notifications, error, loading, refetch };
}

export function useUserUnreadNotificationCount(intervalMs = 10000) {
  const [count, setCount] = useState(0);
  const [error, setError] = useState<Error | null>(null);
  const requestId = useRef(0);

  const refresh = useCallback(async () => {
    const currentRequestId = ++requestId.current;
    try {
      const result = await getUserUnreadNotificationCount();
      if (currentRequestId === requestId.current) {
        setCount(result);
        setError(null);
      }
    } catch (caught) {
      if (currentRequestId === requestId.current) setError(toError(caught));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      if (!document.hidden) void refresh();
    }, intervalMs);
    return () => {
      requestId.current += 1;
      window.clearInterval(timer);
    };
  }, [intervalMs, refresh]);

  return { count, error };
}
