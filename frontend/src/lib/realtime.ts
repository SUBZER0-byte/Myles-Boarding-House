export type RealtimeEvent<T = unknown> = {
  op: "event";
  topic: string;
  event: string;
  data: T;
  ts: number;
};

/**
 * Deprecated socket code removed. The app now uses plain AJAX polling only.
 */
export const realtime = {
  isConnected: false,
  onStatus: () => () => undefined,
  subscribe: () => () => undefined,
  publish: () => undefined,
  connect: () => undefined,
};
