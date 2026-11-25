export interface RoomFilters {
  roomNumber: string;
  floor: string;
  capacity: string;
  description: string;
  minPrice: string;
  maxPrice: string;
}

export const emptyRoomFilters: RoomFilters = {
  roomNumber: "",
  floor: "",
  capacity: "",
  description: "",
  minPrice: "",
  maxPrice: "",
};

export interface FilterableRoom {
  room_number: string;
  floor_number: number;
  capacity: number;
  monthly_rent: number | string;
  description?: string | null;
}

function priceBound(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function filterRooms<T extends FilterableRoom>(rooms: T[], filters: RoomFilters): T[] {
  const roomNumber = filters.roomNumber.trim().toLocaleLowerCase();
  const description = filters.description.trim().toLocaleLowerCase();
  const minPrice = priceBound(filters.minPrice);
  const maxPrice = priceBound(filters.maxPrice);

  return rooms.filter(room => {
    const price = Number(room.monthly_rent);
    return (
      (!roomNumber || room.room_number.trim().toLocaleLowerCase() === roomNumber)
      && (!filters.floor || String(room.floor_number) === filters.floor)
      && (!filters.capacity || String(room.capacity) === filters.capacity)
      && (!description || (room.description ?? "").toLocaleLowerCase().includes(description))
      && (minPrice === null || price >= minPrice)
      && (maxPrice === null || price <= maxPrice)
    );
  });
}

export function hasRoomFilters(filters: RoomFilters): boolean {
  return Object.values(filters).some(value => value.trim() !== "");
}

export function getRoomFilterOptions<
  T extends Pick<FilterableRoom, "room_number" | "floor_number" | "capacity">
>(
  rooms: T[],
): { roomNumbers: string[]; floors: number[]; capacities: number[] } {
  return {
    roomNumbers: [...new Set(rooms.map(room => room.room_number.trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })),
    floors: [...new Set(rooms.map(room => room.floor_number))].sort((a, b) => a - b),
    capacities: [...new Set(rooms.map(room => room.capacity))].sort((a, b) => a - b),
  };
}
