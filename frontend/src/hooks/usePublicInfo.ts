import { useEffect, useRef, useState } from "react";
import {
  getPublicAnnouncements,
  getPublicHouseInfo,
  type PublicAnnouncement,
  type PublicHouseInfo,
} from "@/lib/publicInfo";

function toError(caught: unknown): Error {
  return caught instanceof Error ? caught : new Error("Could not load public information.");
}

export function usePublicAnnouncements(intervalMs = 15000) {
  const [announcements, setAnnouncements] = useState<PublicAnnouncement[] | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const requestId = useRef(0);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const currentRequestId = ++requestId.current;
      try {
        const result = await getPublicAnnouncements();
        if (active && currentRequestId === requestId.current) {
          setAnnouncements(result);
          setError(null);
        }
      } catch (caught) {
        if (active && currentRequestId === requestId.current) {
          setError(toError(caught));
        }
      } finally {
        if (active && currentRequestId === requestId.current) setLoading(false);
      }
    };

    void refresh();
    const timer = window.setInterval(() => void refresh(), intervalMs);
    return () => {
      active = false;
      requestId.current += 1;
      window.clearInterval(timer);
    };
  }, [intervalMs]);

  return { announcements, error, loading };
}

export function usePublicHouseInfo(intervalMs = 5000) {
  const [houseInfo, setHouseInfo] = useState<PublicHouseInfo | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const currentRequestId = ++requestId.current;
      try {
        const result = await getPublicHouseInfo();
        if (active && currentRequestId === requestId.current) {
          setHouseInfo(result);
          setError(null);
        }
      } catch (caught) {
        if (active && currentRequestId === requestId.current) {
          setError(toError(caught));
        }
      }
    };

    void refresh();
    const timer = window.setInterval(() => void refresh(), intervalMs);
    return () => {
      active = false;
      requestId.current += 1;
      window.clearInterval(timer);
    };
  }, [intervalMs]);

  return { houseInfo, error };
}
