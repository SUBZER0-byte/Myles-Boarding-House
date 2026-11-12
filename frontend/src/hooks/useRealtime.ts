import { useMemo } from "react";

/**
 * Kept as a compatibility stub so legacy websocket-based code does not keep
 * trying to subscribe to a socket. All refresh behavior is handled via AJAX
 * polling.
 */
export function useRealtime<T = unknown>() {
  return useMemo(
    () => ({
      last: null,
      connected: false,
      publish: () => undefined,
    }),
    []
  );
}
