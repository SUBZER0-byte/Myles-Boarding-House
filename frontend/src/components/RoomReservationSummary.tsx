import { useEffect, useState } from "react";
import { formatPhilippineDateTime } from "@/lib/philippineTime";

interface RoomReservationSummaryProps {
  deadlines: number[] | undefined;
  serverNowEpoch?: number;
  className?: string;
}

function formatRemainingTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  return `${hours}h ${minutes}m ${remainingSeconds}s`;
}

export function RoomReservationSummary({
  deadlines = [],
  serverNowEpoch,
  className = "",
}: RoomReservationSummaryProps) {
  const [now, setNow] = useState(() => Date.now());
  const [serverOffset, setServerOffset] = useState(0);

  useEffect(() => {
    if (deadlines.length === 0) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [deadlines]);

  useEffect(() => {
    if (serverNowEpoch && Number.isSafeInteger(serverNowEpoch)) {
      setServerOffset(serverNowEpoch * 1000 - Date.now());
    } else {
      setServerOffset(0);
    }
  }, [serverNowEpoch]);

  const currentTime = now + serverOffset;
  const activeDeadlines = deadlines
    .filter((deadline) => Number.isSafeInteger(deadline) && deadline * 1000 > currentTime)
    .sort((first, second) => first - second);
  const nextDeadline = activeDeadlines[0];
  if (!nextDeadline) return null;
  const activeCount = activeDeadlines.length;
  const remainingSeconds = Math.ceil((nextDeadline * 1000 - currentTime) / 1000);

  return (
    <div className={`rounded-md border border-warning/40 bg-warning/10 px-2.5 py-2 text-xs text-foreground ${className}`}>
      <p className="font-medium">
        Reserved by {activeCount} guest{activeCount === 1 ? "" : "s"}
      </p>
      <p className="text-muted-foreground" aria-live="off">
        Next expires in {formatRemainingTime(remainingSeconds)} ·{" "}
        {formatPhilippineDateTime(nextDeadline * 1000)} PHT
      </p>
    </div>
  );
}
