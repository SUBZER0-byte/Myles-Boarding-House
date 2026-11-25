import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  emptyRoomFilters,
  hasRoomFilters,
  type RoomFilters as RoomFilterValues,
} from "@/lib/roomFilters";
import { X } from "lucide-react";

interface RoomFiltersProps {
  filters: RoomFilterValues;
  roomNumbers: string[];
  floors: number[];
  capacities: number[];
  resultCount: number;
  totalCount: number;
  onChange: (filters: RoomFilterValues) => void;
}

export function RoomFilters({
  filters,
  roomNumbers,
  floors,
  capacities,
  resultCount,
  totalCount,
  onChange,
}: RoomFiltersProps) {
  const active = hasRoomFilters(filters);
  const update = (key: keyof RoomFilterValues, value: string) => {
    onChange({ ...filters, [key]: value });
  };

  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-4" aria-label="Filter rooms">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <div className="grid gap-1.5">
          <Label htmlFor="room-number-filter">Room Number</Label>
          <Select value={filters.roomNumber || "all"} onValueChange={value => update("roomNumber", value === "all" ? "" : value)}>
            <SelectTrigger id="room-number-filter" aria-label="Filter by room number">
              <SelectValue placeholder="All room numbers" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All room numbers</SelectItem>
              {roomNumbers.map(roomNumber => (
                <SelectItem key={roomNumber} value={roomNumber}>Room {roomNumber}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="room-floor-filter">Floor</Label>
          <Select value={filters.floor || "all"} onValueChange={value => update("floor", value === "all" ? "" : value)}>
            <SelectTrigger id="room-floor-filter" aria-label="Filter by floor">
              <SelectValue placeholder="All floors" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All floors</SelectItem>
              {floors.map(floor => (
                <SelectItem key={floor} value={String(floor)}>Floor {floor}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="room-capacity-filter">Capacity</Label>
          <Select value={filters.capacity || "all"} onValueChange={value => update("capacity", value === "all" ? "" : value)}>
            <SelectTrigger id="room-capacity-filter" aria-label="Filter by capacity">
              <SelectValue placeholder="Any capacity" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any capacity</SelectItem>
              {capacities.map(capacity => (
                <SelectItem key={capacity} value={String(capacity)}>
                  {capacity} {capacity === 1 ? "person" : "people"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="room-description-search">Description</Label>
          <Input
            id="room-description-search"
            type="search"
            placeholder="Search room description"
            value={filters.description}
            onChange={event => update("description", event.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="room-min-price-filter">Min monthly rent (₱/person)</Label>
          <Input
            id="room-min-price-filter"
            type="number"
            min="0"
            step="any"
            inputMode="decimal"
            placeholder="No minimum"
            value={filters.minPrice}
            onChange={event => update("minPrice", event.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="room-max-price-filter">Max monthly rent (₱/person)</Label>
          <Input
            id="room-max-price-filter"
            type="number"
            min="0"
            step="any"
            inputMode="decimal"
            placeholder="No maximum"
            value={filters.maxPrice}
            onChange={event => update("maxPrice", event.target.value)}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <p role="status" aria-live="polite">
          Showing {resultCount} of {totalCount} room{totalCount === 1 ? "" : "s"}
        </p>
        {active && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8"
            onClick={() => onChange({ ...emptyRoomFilters })}
          >
            <X size={14} className="mr-1" />
            Clear filters
          </Button>
        )}
      </div>
    </section>
  );
}
