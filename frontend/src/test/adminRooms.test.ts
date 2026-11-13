import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, upload, remove, getPublicUrl } = vi.hoisted(() => ({
  rpc: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  getPublicUrl: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc,
    storage: {
      from: () => ({ upload, remove, getPublicUrl }),
    },
  },
}));

import {
  deleteMyAdminRoom,
  getAdminRoomCoverUrl,
  getMyAdminRooms,
  saveMyAdminRoom,
  setMyAdminRoomStatus,
  uploadMyAdminRoomCover,
} from "@/lib/adminRooms";

describe("Admin rooms", () => {
  beforeEach(() => {
    rpc.mockReset();
    upload.mockReset();
    remove.mockReset();
    getPublicUrl.mockReset();
  });

  it("loads rooms and validates the RPC result", async () => {
    rpc.mockResolvedValue({
      data: [{
        room_id: 3,
        room_number: "A1",
        room_type: "Single",
        capacity: 1,
        monthly_rent: "9000.00",
        status: "Available",
        description: null,
        image: null,
        occupants: 0,
      }],
      error: null,
    });
    await expect(getMyAdminRooms()).resolves.toMatchObject([{ room_id: 3, monthly_rent: 9000 }]);
  });

  it("saves room details through the Admin RPC and rejects invalid input", async () => {
    rpc.mockResolvedValue({ data: 4, error: null });
    const room = {
      room_id: null,
      room_number: "A2",
      room_type: "Double",
      capacity: 2,
      monthly_rent: 12000,
      status: "Available",
      description: "",
    };
    await expect(saveMyAdminRoom(room)).resolves.toBe(4);
    expect(rpc).toHaveBeenCalledWith("save_my_admin_room", {
      p_room_id: null,
      p_room_number: "A2",
      p_room_type: "Double",
      p_capacity: 2,
      p_monthly_rent: 12000,
      p_status: "Available",
      p_description: "",
    });
    await expect(saveMyAdminRoom({ ...room, capacity: 0 })).rejects.toThrow("valid room details");
  });

  it("uses the Admin status and delete operations", async () => {
    rpc
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: null, error: null });
    await setMyAdminRoomStatus(4, "Maintenance");
    await deleteMyAdminRoom(4);
    expect(rpc).toHaveBeenNthCalledWith(1, "set_my_admin_room_status", {
      p_room_id: 4,
      p_status: "Maintenance",
    });
    expect(rpc).toHaveBeenNthCalledWith(3, "delete_my_admin_room", { p_room_id: 4 });
  });

  it("cleans up an uploaded cover when it cannot be linked", async () => {
    rpc.mockResolvedValue({ data: null, error: new Error("link failed") });
    upload.mockResolvedValue({ error: null });
    remove.mockResolvedValue({ error: null });
    const file = new File(["image"], "room.jpg", { type: "image/jpeg" });
    await expect(uploadMyAdminRoomCover(4, file)).rejects.toThrow("link failed");
    expect(remove).toHaveBeenCalledWith([expect.stringMatching(/^covers\/4\//)]);
  });

  it("uses Supabase URLs for stored covers and ignores legacy paths", () => {
    getPublicUrl.mockReturnValue({ data: { publicUrl: "https://storage.example/room.jpg" } });
    expect(getAdminRoomCoverUrl("covers/4/a-b.jpg")).toBe("https://storage.example/room.jpg");
    expect(getAdminRoomCoverUrl("legacy-cover.jpg")).toBe("");
  });
});
