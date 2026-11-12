import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc },
}));

import { getPublicRoomPhotos, getPublicRooms } from "@/lib/publicRooms";

describe("public room reads", () => {
  beforeEach(() => {
    rpc.mockReset();
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
});
