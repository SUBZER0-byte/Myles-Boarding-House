import { createContext, useContext } from "react";

export interface RoomAvailabilityRange {
  checkInDate: string;
  checkOutDate: string;
}

export interface RoomAvailabilityContextValue {
  range: RoomAvailabilityRange | null;
}

export const RoomAvailabilityContext = createContext<RoomAvailabilityContextValue | null>(null);

export function useRoomAvailabilityRange(): RoomAvailabilityRange | null {
  return useContext(RoomAvailabilityContext)?.range ?? null;
}
