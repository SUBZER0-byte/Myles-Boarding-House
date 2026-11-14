import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, getPublicUrl } = vi.hoisted(() => ({ rpc: vi.fn(), getPublicUrl: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc,
    storage: { from: vi.fn(() => ({ getPublicUrl })) },
  },
}));

import { getPublicRoomImageUrl, getPublicRoomPhotos, getPublicRooms, getPublicRoomsForDates } from "@/lib/publicRooms";

describe("public room reads", () => {
  beforeEach(() => {
    rpc.mockReset();
    getPublicUrl.mockReset();
    getPublicUrl.mockImplementation((path: string) => ({ data: { publicUrl: `https://storage.example/${path}` } }));
  });

  it("resolves flat and nested Storage keys but rejects external or unsafe image paths", () => {
    expect(getPublicRoomImageUrl("covers/7/room-cover.jpg")).toBe("https://storage.example/covers/7/room-cover.jpg");
    expect(getPublicRoomImageUrl("room_36_legacy-cover.jpg")).toBe("https://storage.example/room_36_legacy-cover.jpg");
    expect(getPublicRoomImageUrl("uploads/rooms/old-room.jpg")).toBe("https://storage.example/uploads/rooms/old-room.jpg");
    expect(getPublicRoomImageUrl("https://example.com/room.jpg")).toBe("");
    expect(getPublicRoomImageUrl("../private.jpg")).toBe("");
  });

  it("uses the read-only public room listing RPC", async () => {
    const rooms = [{ room_id: 7, room_number: "A1" }];
    rpc.mockResolvedValue({ data: rooms, error: null });

    await expect(getPublicRooms()).resolves.toEqual(rooms);
    expect(rpc).toHaveBeenCalledWith("get_public_rooms");
  });

  it("passes the selected room to the public photo RPC", async () => {
    const photos = [{ image_id: 2, filename: "room.jpg", caption: "Room", sort_order: 1 }];
    rpc.mockResolvedValue({ data: photos, error: null });

    await expect(getPublicRoomPhotos(7)).resolves.toEqual(photos);
    expect(rpc).toHaveBeenCalledWith("get_public_room_photos", { p_room_id: 7 });
  });

  it("loads date-specific room capacity from the availability RPC", async () => {
    const rooms = [{ room_id: 7, available_beds: 2, available_for_dates: true }];
    rpc.mockResolvedValue({ data: rooms, error: null });

    await expect(getPublicRoomsForDates("2026-12-01", "2027-01-01")).resolves.toEqual(rooms);
    expect(rpc).toHaveBeenCalledWith("get_public_rooms_for_dates", {
      p_check_in_date: "2026-12-01",
      p_check_out_date: "2027-01-01",
    });
  });

  it("rejects malformed availability responses", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(getPublicRoomsForDates("2026-12-01", "2027-01-01")).rejects.toThrow("invalid list");
  });
});
