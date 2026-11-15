import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke } },
}));

import { listTenantRatings, submitTenantRating } from "@/lib/tenantRatings";

describe("tenant rating operations", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it("loads only the current tenant's ratings through the Edge Function", async () => {
    const ratings = [{
      rating_id: 4,
      category: "Services",
      moderation_status: "Pending",
      admin_reply: null,
      stars: 4.5,
      comment: "Helpful",
      created_at: "2026-01-01",
    }];
    invoke.mockResolvedValue({ data: { type: "success", data: ratings }, error: null });

    await expect(listTenantRatings()).resolves.toEqual(ratings);
    expect(invoke).toHaveBeenCalledWith("tenant-ratings", { body: { action: "list" } });
  });

  it("submits rating data without a browser-provided tenant ID", async () => {
    invoke.mockResolvedValue({ data: { type: "success" }, error: null });

    await submitTenantRating({ stars: 4.5, category: "Services", comment: "Helpful" });
    expect(invoke).toHaveBeenCalledWith("tenant-ratings", {
      body: { action: "submit", stars: 4.5, category: "Services", comment: "Helpful" },
    });
  });

  it("surfaces server validation failures", async () => {
    invoke.mockResolvedValue({ data: { type: "error", message: "Invalid rating." }, error: null });

    await expect(submitTenantRating({ stars: 4, category: "Services", comment: "" }))
      .rejects.toThrow("Invalid rating.");
  });
});
