import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, getPublicUrl } = vi.hoisted(() => ({ rpc: vi.fn(), getPublicUrl: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc,
    storage: { from: vi.fn(() => ({ getPublicUrl })) },
  },
}));

import {
  getCurrentPhilippineDate,
  getPublicRoomImageUrl,
  getPublicRoomPhotos,
  getPublicRooms,
  getPublicRoomsForDates,
  isRoomGenderCompatible,
} from "@/lib/publicRooms";
import { formatRoomFloor } from "@/lib/roomFloor";

describe("public room reads", () => {
  beforeEach(() => {
    rpc.mockReset();
    getPublicUrl.mockReset();
    getPublicUrl.mockImplementation((path: string) => ({ data: { publicUrl: `https://storage.example/${path}` } }));
  });

  it("uses the first known occupant gender to determine room compatibility", () => {
    expect(isRoomGenderCompatible(["Female", "Male"], "Female")).toBe(true);
    expect(isRoomGenderCompatible(["Female", "Male"], "Male")).toBe(false);
    expect(isRoomGenderCompatible(["Not provided", "Male"], "Female")).toBe(false);
    expect(isRoomGenderCompatible(["Not provided"], "Female")).toBe(true);
    expect(isRoomGenderCompatible([], "Male")).toBe(true);
  });

  it("resolves flat and nested Storage keys but rejects external or unsafe image paths", () => {
    expect(getPublicRoomImageUrl("covers/7/room-cover.jpg")).toBe("https://storage.example/covers/7/room-cover.jpg");
    expect(getPublicRoomImageUrl("room_36_legacy-cover.jpg")).toBe("https://storage.example/room_36_legacy-cover.jpg");
    expect(getPublicRoomImageUrl("uploads/rooms/old-room.jpg")).toBe("https://storage.example/uploads/rooms/old-room.jpg");
    expect(getPublicRoomImageUrl("https://example.com/room.jpg")).toBe("");
    expect(getPublicRoomImageUrl("../private.jpg")).toBe("");
  });

  it("uses the public room listing RPC with occupant gender data", async () => {
    const rooms = [
      { room_id: 10, room_number: "10", floor_number: 1, occupant_genders: [], reservation_count: 0, reservation_deadlines_epoch: [], reservation_server_now_epoch: 1795651200 },
      { room_id: 2, room_number: "2", floor_number: 2, occupant_genders: ["Male"], reservation_count: 0, reservation_deadlines_epoch: [], reservation_server_now_epoch: 1795651200 },
      { room_id: 1, room_number: "1", floor_number: 3, occupant_genders: [], reservation_count: 0, reservation_deadlines_epoch: [], reservation_server_now_epoch: 1795651200 },
      { room_id: 11, room_number: "11", floor_number: 4, occupant_genders: ["Female"], reservation_count: 0, reservation_deadlines_epoch: [], reservation_server_now_epoch: 1795651200 },
    ];
    rpc.mockResolvedValue({ data: rooms, error: null });

    await expect(getPublicRooms()).resolves.toEqual([rooms[2], rooms[1], rooms[0], rooms[3]]);
    expect(rpc.mock.calls[0][0]).toBe("get_public_rooms_for_guest_browse_with_booking_state");
    expect(rpc.mock.calls[0][1]).toEqual(expect.objectContaining({
      p_check_in_date: expect.any(String),
      p_check_out_date: expect.any(String),
    }));
  });

  it("passes the selected room to the public photo RPC", async () => {
    const photos = [{ image_id: 2, filename: "room.jpg", caption: "Room", sort_order: 1 }];
    rpc.mockResolvedValue({ data: photos, error: null });

    await expect(getPublicRoomPhotos(7)).resolves.toEqual(photos);
    expect(rpc).toHaveBeenCalledWith("get_public_room_photos", { p_room_id: 7 });
  });

  it("loads database room status, date-specific capacity, and current occupant genders", async () => {
    const rooms = [
      {
        room_id: 10, room_number: "10", floor_number: 1, status: "Occupied",
        occupant_genders: ["Male"], has_active_booking: true,
        reservation_count: 1, reservation_deadlines_epoch: [1795651200],
        reservation_server_now_epoch: 1795647600,
      },
      {
        room_id: 2, room_number: "2", floor_number: 2, status: "Occupied",
        occupant_genders: ["Female"], has_active_booking: false,
        reservation_count: 0, reservation_deadlines_epoch: [],
        reservation_server_now_epoch: 1795647600,
      },
    ];
    rpc.mockResolvedValue({ data: rooms, error: null });

    await expect(getPublicRoomsForDates("2026-12-01", "2027-01-01"))
      .resolves.toEqual([
        { ...rooms[1], occupant_genders: ["Female"] },
        { ...rooms[0], occupant_genders: ["Male"] },
      ]);
    expect(rpc).toHaveBeenCalledWith("get_public_rooms_for_guest_browse_with_booking_state", {
      p_check_in_date: "2026-12-01",
      p_check_out_date: "2027-01-01",
    });
  });

  it("rejects malformed availability responses", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(getPublicRoomsForDates("2026-12-01", "2027-01-01")).rejects.toThrow("invalid list");
  });

  it("rejects booking ownership data that is not a boolean", async () => {
    rpc.mockResolvedValue({
      data: [{
        room_id: 1, room_number: "1", floor_number: 1, occupant_genders: [],
        has_active_booking: "true", reservation_count: 0, reservation_deadlines_epoch: [],
        reservation_server_now_epoch: 1795651200,
      }],
      error: null,
    });
    await expect(getPublicRoomsForDates("2026-12-01", "2027-01-01"))
      .rejects.toThrow("invalid booking ownership data");
  });

  it("rejects room reads with an invalid floor number", async () => {
    rpc.mockResolvedValue({
      data: [{
        room_id: 1, room_number: "1", floor_number: 0, occupant_genders: [],
        reservation_count: 0, reservation_deadlines_epoch: [],
        reservation_server_now_epoch: 1795651200,
      }],
      error: null,
    });
    await expect(getPublicRooms()).rejects.toThrow("invalid floor number");
  });

  it("rejects reservation counts that do not match the returned deadlines", async () => {
    rpc.mockResolvedValue({
      data: [{
        room_id: 1, room_number: "1", floor_number: 1, occupant_genders: [],
        reservation_count: 2, reservation_deadlines_epoch: [1795651200],
        reservation_server_now_epoch: 1795651200,
      }],
      error: null,
    });
    await expect(getPublicRooms()).rejects.toThrow("invalid reservation data");
  });

  it("formats floor numbers with the correct ordinal suffix", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21].map(formatRoomFloor)).toEqual([
      "1st Floor", "2nd Floor", "3rd Floor", "4th Floor",
      "11th Floor", "12th Floor", "13th Floor", "21st Floor",
    ]);
  });

  it("uses the current Philippine calendar date for default room availability", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-24T16:30:00.000Z"));

    expect(getCurrentPhilippineDate()).toBe("2026-11-25");
    vi.useRealTimers();
  });
});
