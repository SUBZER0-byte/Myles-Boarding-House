import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { BedDouble, Users, Ruler, Clock, ShieldCheck, Wifi, Wind, Tv, Bath, Briefcase, Flower2 } from "lucide-react";

interface RoomDetails {
  image: string;
  name: string;
  price: string;
  status: "available" | "occupied" | "maintenance";
  amenities: string[];
}

interface RoomDetailsDialogProps {
  room: RoomDetails | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onBook?: () => void;
}

const amenityIcons: Record<string, React.ElementType> = {
  WiFi: Wifi,
  AC: Wind,
  TV: Tv,
  Bath: Bath,
  Desk: Briefcase,
  Closet: ShieldCheck,
  Balcony: Flower2,
};

const mockDetails: Record<string, { description: string; floor: string; capacity: string; size: string; availableFrom: string; rules: string[] }> = {
  "Single Room A1": {
    description: "A cozy single room perfect for students or solo professionals. Features a comfortable bed, study desk, and built-in storage. Natural light fills the room through a large window facing the garden.",
    floor: "1st Floor",
    capacity: "1 person",
    size: "16 sqm",
    availableFrom: "Immediately",
    rules: ["No smoking", "Quiet hours: 10PM–6AM", "No pets", "Visitors until 9PM only"],
  },
  "Double Room B2": {
    description: "A spacious double room ideal for friends or couples. Equipped with two beds, a flat-screen TV, and a large closet. Located on the second floor with easy access to the shared kitchen.",
    floor: "2nd Floor",
    capacity: "2 persons",
    size: "24 sqm",
    availableFrom: "Currently occupied",
    rules: ["No smoking", "Quiet hours: 10PM–6AM", "No pets", "Visitors until 9PM only"],
  },
  "Premium Suite C1": {
    description: "Our premium suite offers the best boarding experience — a private bathroom, balcony with a city view, flat-screen TV, and premium furnishings. Perfect for professionals who value comfort and privacy.",
    floor: "3rd Floor",
    capacity: "2 persons",
    size: "32 sqm",
    availableFrom: "Immediately",
    rules: ["No smoking", "Quiet hours: 10PM–6AM", "Small pets allowed", "Visitors until 10PM"],
  },
  "Single Room A2": {
    description: "Another well-maintained single room on the first floor. Comes with a study desk, air conditioning, and reliable WiFi. Great for students attending nearby universities.",
    floor: "1st Floor",
    capacity: "1 person",
    size: "16 sqm",
    availableFrom: "Immediately",
    rules: ["No smoking", "Quiet hours: 10PM–6AM", "No pets", "Visitors until 9PM only"],
  },
  "Double Room B3": {
    description: "A bright double room on the second floor with two beds, a TV, and ample closet space. Freshly painted walls and new mattresses make this a comfortable choice.",
    floor: "2nd Floor",
    capacity: "2 persons",
    size: "24 sqm",
    availableFrom: "Immediately",
    rules: ["No smoking", "Quiet hours: 10PM–6AM", "No pets", "Visitors until 9PM only"],
  },
  "Premium Suite C2": {
    description: "A luxurious suite with a private balcony overlooking the neighborhood. Features a full private bathroom, premium bedding, and a mini work area. Currently occupied by a long-term tenant.",
    floor: "3rd Floor",
    capacity: "2 persons",
    size: "32 sqm",
    availableFrom: "Currently occupied",
    rules: ["No smoking", "Quiet hours: 10PM–6AM", "Small pets allowed", "Visitors until 10PM"],
  },
};

const statusStyles = {
  available: "bg-success text-white",
  occupied: "bg-destructive text-white",
  maintenance: "bg-warning text-white",
};

export function RoomDetailsDialog({ room, open, onOpenChange, onBook }: RoomDetailsDialogProps) {
  if (!room) return null;

  const details = mockDetails[room.name] || mockDetails["Single Room A1"];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto p-0">
        <div className="relative">
          <img src={room.image} alt={room.name} className="w-full h-56 object-cover rounded-t-lg" />
        </div>

        <div className="p-6 pt-4">
          <DialogHeader className="mb-4">
            <DialogTitle className="font-display text-2xl">{room.name}</DialogTitle>
            <p className="text-primary font-bold text-xl mt-1">
              {room.price}<span className="text-sm text-muted-foreground font-normal">/month</span>
            </p>
          </DialogHeader>

          <p className="text-sm text-muted-foreground leading-relaxed">{details.description}</p>

          {/* Quick info */}
          <div className="grid grid-cols-2 gap-3 mt-5">
            <div className="flex items-center gap-2 text-sm">
              <BedDouble size={16} className="text-primary" />
              <span>{details.floor}</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Users size={16} className="text-primary" />
              <span>{details.capacity}</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Ruler size={16} className="text-primary" />
              <span>{details.size}</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Clock size={16} className="text-primary" />
              <span>{details.availableFrom}</span>
            </div>
          </div>

          {/* Amenities */}
          <div className="mt-5">
            <h4 className="font-display font-semibold text-sm mb-2">Amenities</h4>
            <div className="flex flex-wrap gap-2">
              {room.amenities.map((a) => {
                const Icon = amenityIcons[a];
                return (
                  <Badge key={a} variant="secondary" className="flex items-center gap-1.5 py-1 px-2.5">
                    {Icon && <Icon size={13} />}
                    {a}
                  </Badge>
                );
              })}
            </div>
          </div>

          {/* House rules */}
          <div className="mt-5">
            <h4 className="font-display font-semibold text-sm mb-2">House Rules</h4>
            <ul className="text-sm text-muted-foreground space-y-1">
              {details.rules.map((rule) => (
                <li key={rule} className="flex items-start gap-2">
                  <ShieldCheck size={14} className="text-primary mt-0.5 shrink-0" />
                  {rule}
                </li>
              ))}
            </ul>
          </div>

          {/* Action button */}
          {onBook && (
            <button
              onClick={onBook}
              className="w-full mt-6 py-3 rounded-md bg-primary text-primary-foreground font-medium hover:opacity-90 transition-opacity"
            >
              Book This Room
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
