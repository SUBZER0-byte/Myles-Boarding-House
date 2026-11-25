import { describe, expect, it } from "vitest";
import {
  emptyRoomFilters,
  filterRooms,
  getRoomFilterOptions,
} from "@/lib/roomFilters";

const rooms = [
  { room_number: "101A", floor_number: 1, capacity: 2, monthly_rent: 2500, description: "Quiet garden room" },
  { room_number: "202", floor_number: 2, capacity: 4, monthly_rent: "4500", description: null },
  { room_number: "203", floor_number: 2, capacity: 2, monthly_rent: 5500, description: "Window view" },
];

describe("room filtering", () => {
  it("filters by exact room number and case-insensitive description with combined filters", () => {
    expect(filterRooms(rooms, {
      ...emptyRoomFilters,
      roomNumber: "101a",
      floor: "1",
      capacity: "2",
      description: "GARDEN",
    })).toEqual([rooms[0]]);
  });

  it("does not partially match a selected room number", () => {
    expect(filterRooms(rooms, {
      ...emptyRoomFilters,
      roomNumber: "101",
    })).toEqual([]);
  });

  it("filters monthly price inclusively by minimum and maximum", () => {
    expect(filterRooms(rooms, {
      ...emptyRoomFilters,
      minPrice: "4500",
      maxPrice: "5500",
    })).toEqual([rooms[1], rooms[2]]);
  });

  it("derives naturally sorted room number and ascending floor and capacity options", () => {
    expect(getRoomFilterOptions(rooms)).toEqual({
      roomNumbers: ["101A", "202", "203"],
      floors: [1, 2],
      capacities: [2, 4],
    });
  });
});
