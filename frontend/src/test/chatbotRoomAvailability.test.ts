import { describe, expect, it } from "vitest";
import {
  getCurrentManilaAvailabilityDateRange,
  parseAvailabilityDateRange,
  toPublicRoomAvailability,
} from "../../../supabase/functions/_shared/room_availability";

describe("chatbot room availability context", () => {
  it("uses the current Manila date and next day for the availability window", () => {
    expect(getCurrentManilaAvailabilityDateRange(new Date("2026-11-22T16:30:00.000Z"))).toEqual({
      checkInDate: "2026-11-23",
      checkOutDate: "2026-11-24",
    });
  });

  it("uses the supplied Guest Browse Rooms dates and rejects invalid ranges", () => {
    const now = new Date("2026-11-22T16:30:00.000Z");
    expect(parseAvailabilityDateRange({
      check_in_date: "2026-12-01",
      check_out_date: "2026-12-31",
    }, now)).toEqual({
      checkInDate: "2026-12-01",
      checkOutDate: "2026-12-31",
    });
    expect(() => parseAvailabilityDateRange({
      check_in_date: "2026-11-22",
      check_out_date: "2026-11-24",
    }, now)).toThrow("The requested room availability dates are invalid.");
    expect(() => parseAvailabilityDateRange({
      check_in_date: "2026-02-30",
      check_out_date: "2026-03-02",
    }, now)).toThrow("The requested room availability dates are invalid.");
  });

  it("whitelists public availability fields and excludes internal room identifiers and types", () => {
    const rooms = toPublicRoomAvailability([{
      room_id: 17,
      room_number: "A-1",
      room_type: "Deluxe",
      floor_number: 1,
      capacity: 4,
      monthly_rent: 8000,
      status: "Available",
      available_beds: 2,
      available_for_dates: true,
      occupants: 2,
      description: "Near the common area",
    }]);

    expect(rooms).toEqual([{
      room_number: "A-1",
      floor_number: 1,
      capacity: 4,
      monthly_rent: 8000,
      status: "Available",
      available_beds: 2,
      available_for_dates: true,
      description: "Near the common area",
    }]);
    expect(JSON.stringify(rooms)).not.toMatch(/room_id|room_type/);
  });

  it("rejects malformed availability responses instead of providing misleading chatbot context", () => {
    expect(() => toPublicRoomAvailability([{ room_number: "A-1" }])).toThrow(
      "Room availability entry 0 is missing required data.",
    );
  });
});
