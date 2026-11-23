import { useMemo, type ReactNode } from "react";
import { RoomAvailabilityContext, type RoomAvailabilityRange } from "@/lib/roomAvailabilityContext";

export function RoomAvailabilityProvider({
  children,
  range,
}: {
  children: ReactNode;
  range: RoomAvailabilityRange | null;
}) {
  const value = useMemo(() => ({ range }), [range]);

  return (
    <RoomAvailabilityContext.Provider value={value}>
      {children}
    </RoomAvailabilityContext.Provider>
  );
}
