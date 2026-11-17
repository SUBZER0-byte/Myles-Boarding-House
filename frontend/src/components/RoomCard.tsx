import { BedDouble } from "lucide-react";
import { GuestRoomPhotoSlideshow } from "@/components/GuestRoomPhotoSlideshow";

export interface RoomDisplayData {
  room_id: number;
  room_number: string;
  room_type: string;
  image: string;
  monthly_rent: number;
  status: string;
  capacity: number;
  available_beds: number;
  description: string | null;
}

interface RoomCardProps {
  room: RoomDisplayData;
  onView: () => void;
}

function statusStyle(status: string): string {
  switch (status.toLowerCase()) {
    case "available":
      return "bg-success/15 text-success border-success/30";
    case "occupied":
      return "bg-destructive/15 text-destructive border-destructive/30";
    case "reserved":
      return "bg-warning/15 text-warning border-warning/30";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

export function RoomCard({ room, onView }: RoomCardProps) {
  return (
    <div className="flex h-full flex-col rounded-lg border border-border bg-card p-5 shadow-sm transition-shadow hover:shadow-lg">
      <GuestRoomPhotoSlideshow
        roomId={room.room_id}
        roomNumber={room.room_number}
        coverImage={room.image}
      />
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <BedDouble size={18} className="text-primary" />
          <span className="font-display font-semibold">Room {room.room_number}</span>
        </div>
        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${statusStyle(room.status)}`}>
          {room.status || "Unknown"}
        </span>
      </div>
      <p className="mb-2 text-xs text-muted-foreground">{room.room_type}</p>
      {room.capacity >= 2 && (
        <p className="mb-2 text-xs text-muted-foreground">
          {room.available_beds} bedspace(s) available
        </p>
      )}
      {room.description && (
        <p className="mb-3 line-clamp-3 text-xs text-muted-foreground">{room.description}</p>
      )}
      <div className="mt-auto space-y-2 pt-3">
        <p className="text-sm font-semibold">
          ₱{room.monthly_rent.toLocaleString()}
          <span className="text-xs font-normal text-muted-foreground">/mo</span>
        </p>
        <button
          type="button"
          onClick={onView}
          className="w-full rounded-md border border-border py-2 text-sm font-medium hover:bg-muted"
        >
          View Details
        </button>
      </div>
    </div>
  );
}
