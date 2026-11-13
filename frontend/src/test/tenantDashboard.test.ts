import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke } },
}));

import { getTenantDashboard } from "@/lib/tenantDashboard";

describe("tenant dashboard reads", () => {
  beforeEach(() => {
    invoke.mockReset();
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
});
