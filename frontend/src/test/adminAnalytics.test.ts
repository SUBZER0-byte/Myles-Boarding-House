import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke } },
}));

import { getAdminAnalytics } from "@/lib/adminAnalytics";

describe("admin analytics reads", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it("loads the combined snapshot from the admin-only Edge Function", async () => {
    const analytics = {
      revenue: [],
      bookings: [],
      occupancy: [],
      complaints: [],
      maintenance: [],
      top_tenants: [],
    };
    invoke.mockResolvedValue({ data: { type: "success", data: analytics }, error: null });

    await expect(getAdminAnalytics()).resolves.toEqual(analytics);
    expect(invoke).toHaveBeenCalledWith("admin-analytics", { body: {} });
  });

  it("surfaces function errors", async () => {
    const failure = new Error("Analytics unavailable");
    invoke.mockResolvedValue({ data: null, error: failure });

    await expect(getAdminAnalytics()).rejects.toBe(failure);
  });
});
