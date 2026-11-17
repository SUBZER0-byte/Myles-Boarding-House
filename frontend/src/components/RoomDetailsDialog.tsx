import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { BedDouble } from "lucide-react";
import { GuestRoomPhotoSlideshow } from "@/components/GuestRoomPhotoSlideshow";
import type { RoomDisplayData } from "@/components/RoomCard";

interface RoomDetailsDialogProps {
  room: RoomDisplayData | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
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

export function RoomDetailsDialog({ room, open, onOpenChange }: RoomDetailsDialogProps) {
  if (!room) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto p-0">
        <div className="p-5">
          <DialogHeader className="mb-4">
            <DialogTitle className="font-display text-2xl">Room {room.room_number}</DialogTitle>
            <DialogDescription>{room.room_type}</DialogDescription>
            <p className="text-primary font-bold text-xl mt-1">
              ₱{room.monthly_rent.toLocaleString()}<span className="text-sm text-muted-foreground font-normal">/month</span>
            </p>
          </DialogHeader>

          <GuestRoomPhotoSlideshow
            roomId={room.room_id}
            roomNumber={room.room_number}
            coverImage={room.image}
            expanded
          />
          <div className="flex items-center justify-between gap-3">
            <Badge variant="outline" className={statusStyle(room.status)}>
              {room.status || "Unknown"}
            </Badge>
            <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
              <BedDouble size={16} className="text-primary" />
              Capacity: {room.capacity}
            </span>
          </div>
          {room.capacity >= 2 && (
            <p className="mt-3 text-sm text-muted-foreground">
              {room.available_beds} bedspace(s) available
            </p>
          )}
          {room.description && (
            <div className="mt-4">
              <h4 className="font-display text-sm font-semibold">Description</h4>
              <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{room.description}</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
