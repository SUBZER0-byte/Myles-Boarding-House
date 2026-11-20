import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke, getPublicRooms } = vi.hoisted(() => ({ invoke: vi.fn(), getPublicRooms: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke } },
}));
vi.mock("@/lib/publicRooms", () => ({ getPublicRooms }));

import { getTenantDashboard } from "@/lib/tenantDashboard";

describe("tenant dashboard reads", () => {
  beforeEach(() => {
    invoke.mockReset();
    getPublicRooms.mockReset();
  });

  it("uses the authenticated tenant dashboard function", async () => {
    const dashboard = {
      tenant_name: "Test Tenant",
      room_info: null,
      current_balance: 0,
      next_due_payment: null,
      last_payment: null,
      announcements: [],
      maintenance: [],
      complaints: [],
      maintenance_summary: {},
      complaint_summary: {},
    };
    invoke.mockResolvedValue({ data: { type: "success", data: dashboard }, error: null });

    await expect(getTenantDashboard()).resolves.toEqual(dashboard);
    expect(invoke).toHaveBeenCalledWith("tenant-dashboard", { body: {} });
  });

  it("rejects unsuccessful function responses", async () => {
    invoke.mockResolvedValue({
      data: { type: "error", message: "Tenant record not found." },
      error: null,
    });

    await expect(getTenantDashboard()).rejects.toThrow("Tenant record not found.");
  });

  it("propagates function invocation errors", async () => {
    const failure = new Error("Function unavailable");
    invoke.mockResolvedValue({ data: null, error: failure });

    await expect(getTenantDashboard()).rejects.toBe(failure);
  });

  it("adds the current room floor to the dashboard room summary", async () => {
    invoke.mockResolvedValue({
      data: {
        type: "success",
        data: {
          tenant_name: "Test Tenant",
          room_info: { room_id: 4, room_number: "4", monthly_rent: 5000, status: "Occupied" },
          current_balance: 0,
          next_due_payment: null,
          last_payment: null,
          announcements: [],
          maintenance: [],
          complaints: [],
          maintenance_summary: {},
          complaint_summary: {},
        },
      },
      error: null,
    });
    getPublicRooms.mockResolvedValue([{ room_id: 4, floor_number: 3 }]);

    await expect(getTenantDashboard()).resolves.toMatchObject({
      room_info: { room_id: 4, floor_number: 3 },
    });
  });
});
