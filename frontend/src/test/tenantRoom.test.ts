import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
const { getPublicRooms } = vi.hoisted(() => ({ getPublicRooms: vi.fn() }));

vi.mock("@/lib/supabase", () => ({ supabase: { rpc } }));
vi.mock("@/lib/publicRooms", () => ({ getPublicRooms }));

import { getAvailableTenantRooms, getMyTenantRoom } from "@/lib/tenantRoom";

describe("tenant room reads", () => {
  beforeEach(() => {
    rpc.mockReset();
    getPublicRooms.mockReset();
  });

  it("loads room details through the authenticated self-scoped RPC", async () => {
    const room = {
      room_id: 3,
      tenant_id: 8,
      room_number: "204",
      room_type: "Single",
      capacity: 1,
      monthly_rent: 6500,
      status: "Occupied",
    };
    rpc.mockResolvedValue({ data: room, error: null });

    await expect(getMyTenantRoom()).resolves.toMatchObject(room);
    expect(rpc).toHaveBeenCalledWith("get_my_tenant_room");
  });

  it("does not turn a missing room into an empty success", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(getMyTenantRoom()).rejects.toThrow("No active room assignment found.");
  });

  it("only exposes available rooms in the Tenant room list", async () => {
    getPublicRooms.mockResolvedValue([
      { room_id: 1, status: "Available" },
      { room_id: 2, status: "Occupied" },
    ]);

    await expect(getAvailableTenantRooms()).resolves.toEqual([{ room_id: 1, status: "Available" }]);
  });
});
