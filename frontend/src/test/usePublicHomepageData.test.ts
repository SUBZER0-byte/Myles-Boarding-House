import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getPublicReviews, getPublicStats, useSupabasePolling } = vi.hoisted(() => ({
  getPublicReviews: vi.fn(),
  getPublicStats: vi.fn(),
  useSupabasePolling: vi.fn(),
}));

vi.mock("@/lib/publicHomepage", () => ({ getPublicReviews, getPublicStats }));
vi.mock("@/hooks/useSupabasePolling", () => ({ useSupabasePolling }));

import { usePublicHomepageData } from "@/hooks/usePublicHomepageData";

describe("usePublicHomepageData", () => {
  beforeEach(() => {
    getPublicReviews.mockReset();
    getPublicStats.mockReset();
    useSupabasePolling.mockReset();
  });

  it("exposes loaded review and aggregate data", async () => {
    const reviews = [{ stars: 5, category: "Facilities", comment: "Great", created_at: "2026-01-01", full_name: "Tenant" }];
    const stats = { total_rooms: 10, available_rooms: 2, happy_tenants: 5, avg_rating: 4.5 };
    useSupabasePolling
      .mockReturnValueOnce({ data: reviews, loading: false, error: null })
      .mockReturnValueOnce({ data: stats, loading: false, error: null });

    const { result, unmount } = renderHook(() => usePublicHomepageData(60000));

    expect(result.current.reviews).toEqual(reviews);
    expect(result.current.stats).toEqual(stats);
    expect(result.current.reviewsError).toBeNull();
    expect(result.current.statsError).toBeNull();
    expect(useSupabasePolling).toHaveBeenNthCalledWith(1, getPublicReviews, 60000);
    expect(useSupabasePolling).toHaveBeenNthCalledWith(2, getPublicStats, 60000);
    unmount();
  });

  it("keeps review and statistics failures visible independently", async () => {
    useSupabasePolling
      .mockReturnValueOnce({ data: null, loading: false, error: "Reviews unavailable" })
      .mockReturnValueOnce({
        data: { total_rooms: 0, available_rooms: 0, happy_tenants: 0, avg_rating: 0 },
        loading: false,
        error: null,
      });

    const { result, unmount } = renderHook(() => usePublicHomepageData(60000));

    expect(result.current.reviewsError?.message).toBe("Reviews unavailable");
    expect(result.current.reviews).toBeNull();
    expect(result.current.statsError).toBeNull();
    expect(result.current.statsLoading).toBe(false);
    unmount();
  });
});
