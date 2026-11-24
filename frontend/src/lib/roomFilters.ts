export interface RoomFilters {
  roomNumber: string;
  floor: string;
  capacity: string;
  minPrice: string;
  maxPrice: string;
}

export const emptyRoomFilters: RoomFilters = {
  roomNumber: "",
  floor: "",
  capacity: "",
  minPrice: "",
  maxPrice: "",
};

export interface FilterableRoom {
  room_number: string;
  floor_number: number;
  capacity: number;
  monthly_rent: number | string;
}

function priceBound(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function filterRooms<T extends FilterableRoom>(rooms: T[], filters: RoomFilters): T[] {
  const roomNumber = filters.roomNumber.trim().toLocaleLowerCase();
  const minPrice = priceBound(filters.minPrice);
  const maxPrice = priceBound(filters.maxPrice);

  return rooms.filter(room => {
    const price = Number(room.monthly_rent);
    return (
      (!roomNumber || room.room_number.toLocaleLowerCase().includes(roomNumber))
      && (!filters.floor || String(room.floor_number) === filters.floor)
      && (!filters.capacity || String(room.capacity) === filters.capacity)
      && (minPrice === null || price >= minPrice)
      && (maxPrice === null || price <= maxPrice)
    );
  });
}

export function hasRoomFilters(filters: RoomFilters): boolean {
  return Object.values(filters).some(value => value.trim() !== "");
}

export function getRoomFilterOptions<T extends Pick<FilterableRoom, "floor_number" | "capacity">>(
  rooms: T[],
): { floors: number[]; capacities: number[] } {
  return {
    floors: [...new Set(rooms.map(room => room.floor_number))].sort((a, b) => a - b),
    capacities: [...new Set(rooms.map(room => room.capacity))].sort((a, b) => a - b),
  };
}
