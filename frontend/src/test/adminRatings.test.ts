import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke } },
}));

import {
  deleteAdminRating,
  getAdminRatingCategorySummary,
  getAdminRatingSummary,
  listAdminRatings,
  moderateAdminRating,
  replyToAdminRating,
} from "@/lib/adminRatings";

describe("Admin rating workflows", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it("loads the moderation list, aggregate summary, and category summary", async () => {
    const ratings = [{ rating_id: 3, moderation_status: "Pending" }];
    const summary = { total: 1, average: 4, five: 0 };
    const categories = [{ category: "Facilities", total: 1, average: 4 }];
    invoke
      .mockResolvedValueOnce({ data: { type: "success", data: ratings }, error: null })
      .mockResolvedValueOnce({ data: { type: "success", data: summary }, error: null })
      .mockResolvedValueOnce({ data: { type: "success", data: categories }, error: null });

    await expect(listAdminRatings()).resolves.toEqual(ratings);
    await expect(getAdminRatingSummary()).resolves.toEqual(summary);
    await expect(getAdminRatingCategorySummary()).resolves.toEqual(categories);
    expect(invoke).toHaveBeenNthCalledWith(1, "admin-ratings", {
      body: { action: "list", data: {} },
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "admin-ratings", {
      body: { action: "summary", data: {} },
    });
    expect(invoke).toHaveBeenNthCalledWith(3, "admin-ratings", {
      body: { action: "category_summary", data: {} },
    });
  });

  it("routes moderation, replies, and deletion through the Admin-only service", async () => {
    invoke.mockResolvedValue({ data: { type: "success", message: "Saved." }, error: null });

    await moderateAdminRating(7, "Approved");
    await replyToAdminRating(7, "Thank you for the feedback.");
    await deleteAdminRating(7);
    expect(invoke).toHaveBeenNthCalledWith(1, "admin-ratings", {
      body: { action: "moderate", data: { rating_id: 7, moderation_status: "Approved" } },
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "admin-ratings", {
      body: { action: "reply", data: { rating_id: 7, admin_reply: "Thank you for the feedback." } },
    });
    expect(invoke).toHaveBeenNthCalledWith(3, "admin-ratings", {
      body: { action: "delete", data: { rating_id: 7 } },
    });
  });

  it("surfaces failed actions instead of reporting success", async () => {
    invoke.mockResolvedValue({
      data: { type: "error", message: "Rating not found." },
      error: null,
    });

    await expect(deleteAdminRating(99)).rejects.toThrow("Rating not found.");
  });
});
