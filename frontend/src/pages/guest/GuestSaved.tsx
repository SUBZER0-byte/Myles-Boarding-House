import { DashboardLayout } from "@/components/DashboardLayout";
import { ImagePreview } from "@/components/ImagePreview";
import { Heart, BedDouble, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { usePublicRooms } from "@/hooks/usePublicRooms";
import { Button } from "@/components/ui/button";
import { readSavedRoomIds, writeSavedRoomIds } from "@/lib/savedRooms";
import { getPublicRoomImageUrl } from "@/lib/publicRooms";

const peso = (n: number | string) =>
  "₱" + (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });

function roomImageUrl(image: string): string {
  return getPublicRoomImageUrl(image);
}

type StatusKey = "available" | "occupied" | "reserved" | "maintenance";

const statusBadge: Record<StatusKey, string> = {
  available: "bg-success/15 text-success border-success/30",
  occupied: "bg-destructive/15 text-destructive border-destructive/30",
  reserved: "bg-warning/15 text-warning border-warning/30",
  maintenance: "bg-muted text-muted-foreground border-border",
};

const GuestSaved = () => {
  const { rooms, error } = usePublicRooms(15000);
  const [saved, setSaved] = useState<number[]>([]);

  useEffect(() => {
    setSaved(readSavedRoomIds());
  }, []);

  const remove = (id: number) => {
    const next = saved.filter((s) => s !== id);
    writeSavedRoomIds(next);
    setSaved(next);
  };

  const savedRooms = (rooms ?? []).filter((r) => saved.includes(Number(r.room_id)));

  return (
    <DashboardLayout role="guest">
      <div className="space-y-6">
        <div>
          <h1 className="font-display text-2xl font-bold">Saved Rooms</h1>
          <p className="text-muted-foreground text-sm mt-1">Rooms you've bookmarked for later.</p>
        </div>

        {error && (
          <div className="p-3 rounded-md border border-destructive/30 bg-destructive/10 text-destructive text-xs">
            Could not load rooms: {error.message}
          </div>
        )}

        {!rooms && !error ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 size={14} className="animate-spin" /> Loading saved rooms…
          </div>
        ) : savedRooms.length === 0 ? (
          <div className="bg-card border border-border rounded-lg p-10 text-center">
            <Heart size={32} className="mx-auto text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">No saved rooms yet. Browse rooms and tap the heart icon.</p>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {savedRooms.map((r) => {
              const key = ((r.status || "available").toLowerCase()) as StatusKey;
              const isAvailable = key === "available";
              const imageUrl = r.image ? roomImageUrl(r.image) : "";

              return (
                <div key={r.room_id} className="bg-card border border-border rounded-lg p-5 flex flex-col">
                  {imageUrl && (
                    <ImagePreview
                      src={imageUrl}
                      alt={`Room ${r.room_number}`}
                      triggerClassName="mb-3 w-full overflow-hidden rounded-md"
                      imageClassName="h-36 w-full object-cover"
                    />
                  )}

                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <BedDouble size={18} className="text-primary" />
                      <span className="font-display font-semibold">Room {r.room_number}</span>
                    </div>
                    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${statusBadge[key] || statusBadge.maintenance}`}>
                      {r.status}
                    </span>
                  </div>

                  <p className="text-xs text-muted-foreground mb-2">{r.room_type}</p>
                  {r.description && (
                    <p className="text-xs text-muted-foreground mb-3 line-clamp-3">{r.description}</p>
                  )}

                  <div className="mt-auto pt-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-sm">
                        {peso(r.monthly_rent)}
                        <span className="text-xs text-muted-foreground">/mo</span>
                      </span>
                      <button
                        onClick={() => remove(r.room_id)}
                        className="p-2 rounded-md text-destructive bg-destructive/10 hover:bg-destructive/20 transition-colors"
                        aria-label="Remove from saved"
                      >
                        <Heart size={16} fill="currentColor" />
                      </button>
                    </div>

                    {isAvailable ? (
                      <Button className="w-full" size="sm">
                        Book Now (PayPal)
                      </Button>
                    ) : (
                      <Button className="w-full" size="sm" variant="outline" disabled>
                        Not Available
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
};

export default GuestSaved;
