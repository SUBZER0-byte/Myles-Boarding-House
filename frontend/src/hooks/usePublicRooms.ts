import { useEffect, useRef, useState } from "react";
import { getPublicRooms, type PublicRoom } from "@/lib/publicRooms";

export function usePublicRooms(intervalMs = 5000) {
  const [rooms, setRooms] = useState<PublicRoom[] | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const currentRequestId = ++requestId.current;
      try {
        const result = await getPublicRooms();
        if (active && currentRequestId === requestId.current) {
          setRooms(result);
          setError(null);
        }
      } catch (caught) {
        if (active && currentRequestId === requestId.current) {
          setError(caught instanceof Error ? caught : new Error("Could not load public rooms."));
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

  return { rooms, error };
}
