import { describe, expect, it } from "vitest";
import {
  emptyRoomFilters,
  filterRooms,
  getRoomFilterOptions,
} from "@/lib/roomFilters";

const rooms = [
  { room_number: "101A", floor_number: 1, capacity: 2, monthly_rent: 2500 },
  { room_number: "202", floor_number: 2, capacity: 4, monthly_rent: "4500" },
  { room_number: "203", floor_number: 2, capacity: 2, monthly_rent: 5500 },
];

describe("room filtering", () => {
  it("searches room numbers without case sensitivity and supports combined floor/capacity filters", () => {
    expect(filterRooms(rooms, {
      ...emptyRoomFilters,
      roomNumber: "a",
      floor: "1",
      capacity: "2",
    })).toEqual([rooms[0]]);
  });

  it("filters monthly price inclusively by minimum and maximum", () => {
    expect(filterRooms(rooms, {
      ...emptyRoomFilters,
      minPrice: "4500",
      maxPrice: "5500",
    })).toEqual([rooms[1], rooms[2]]);
  });

  it("derives unique, ascending floor and capacity options", () => {
    expect(getRoomFilterOptions(rooms)).toEqual({
      floors: [1, 2],
      capacities: [2, 4],
    });
  });
});
