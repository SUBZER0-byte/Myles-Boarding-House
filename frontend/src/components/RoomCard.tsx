import { Badge } from "@/components/ui/badge";
import { ImagePreview } from "@/components/ImagePreview";

interface RoomCardProps {
  image: string;
  name: string;
  price: string;
  status: "available" | "occupied" | "maintenance";
  amenities: string[];
  onView?: () => void;
  onBook?: () => void;
  showStatus?: boolean;
}

const statusStyles = {
  available: "bg-success text-white border-success shadow-md",
  occupied: "bg-destructive text-white border-destructive shadow-md",
  maintenance: "bg-warning text-white border-warning shadow-md",
};

export function RoomCard({ image, name, price, status, amenities, onView, onBook, showStatus = true }: RoomCardProps) {
  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden group hover:shadow-lg transition-shadow animate-fade-in">
      <div className="relative overflow-hidden h-48">
        <ImagePreview
          src={image}
          alt={name}
          triggerClassName="h-full w-full"
          imageClassName="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
        />
        {showStatus && (
          <div className="absolute top-3 right-3">
            <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${statusStyles[status]}`}>
              {status.charAt(0).toUpperCase() + status.slice(1)}
            </span>
          </div>
        )}
      </div>
      <div className="p-4">
        <h3 className="font-display font-semibold text-lg">{name}</h3>
        <p className="text-primary font-bold text-xl mt-1">{price}<span className="text-sm text-muted-foreground font-normal">/month</span></p>
        <div className="flex flex-wrap gap-1.5 mt-3">
          {amenities.map((a) => (
            <Badge key={a} variant="secondary" className="text-xs">{a}</Badge>
          ))}
        </div>
        <div className="flex gap-2 mt-4">
          {onView && (
            <button onClick={onView} className="flex-1 py-2 rounded-md border border-border text-sm font-medium hover:bg-muted transition-colors">
              View Details
            </button>
          )}
          {onBook && (
            <button onClick={onBook} className="flex-1 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity">
              Book Now
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
