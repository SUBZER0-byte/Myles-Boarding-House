import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getPublicReviews, getPublicStats } = vi.hoisted(() => ({
  getPublicReviews: vi.fn(),
  getPublicStats: vi.fn(),
}));

vi.mock("@/lib/publicHomepage", () => ({ getPublicReviews, getPublicStats }));

import { usePublicHomepageData } from "@/hooks/usePublicHomepageData";

describe("usePublicHomepageData", () => {
  beforeEach(() => {
    getPublicReviews.mockReset();
    getPublicStats.mockReset();
  });

  it("exposes loaded review and aggregate data", async () => {
    const reviews = [{ stars: 5, category: "Facilities", comment: "Great", created_at: "2026-01-01", full_name: "Tenant" }];
    const stats = { total_rooms: 10, available_rooms: 2, happy_tenants: 5, avg_rating: 4.5 };
    getPublicReviews.mockResolvedValue(reviews);
    getPublicStats.mockResolvedValue(stats);

    const { result, unmount } = renderHook(() => usePublicHomepageData(60000));

    await waitFor(() => expect(result.current.reviews).toEqual(reviews));
    expect(result.current.stats).toEqual(stats);
    expect(result.current.reviewsError).toBeNull();
    expect(result.current.statsError).toBeNull();
    unmount();
  });

  it("keeps review and statistics failures visible independently", async () => {
    getPublicReviews.mockRejectedValue(new Error("Reviews unavailable"));
    getPublicStats.mockResolvedValue({ total_rooms: 0, available_rooms: 0, happy_tenants: 0, avg_rating: 0 });

    const { result, unmount } = renderHook(() => usePublicHomepageData(60000));

    await waitFor(() => expect(result.current.reviewsError?.message).toBe("Reviews unavailable"));
    expect(result.current.reviews).toBeNull();
    expect(result.current.statsError).toBeNull();
    expect(result.current.statsLoading).toBe(false);
    unmount();
  });
});
