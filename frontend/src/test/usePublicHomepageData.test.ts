import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getPublicReviews, getPublicStats, channel, channelOn, subscribe, removeChannel } = vi.hoisted(() => {
  const realtimeChannel = {
    on: vi.fn(),
    subscribe: vi.fn(),
  };
  return {
    getPublicReviews: vi.fn(),
    getPublicStats: vi.fn(),
    channel: vi.fn(() => realtimeChannel),
    channelOn: realtimeChannel.on,
    subscribe: realtimeChannel.subscribe,
    removeChannel: vi.fn(),
  };
});

vi.mock("@/lib/publicHomepage", () => ({ getPublicReviews, getPublicStats }));
vi.mock("@/lib/supabase", () => ({ supabase: { channel, removeChannel } }));

import { usePublicHomepageData } from "@/hooks/usePublicHomepageData";

describe("usePublicHomepageData", () => {
  beforeEach(() => {
    getPublicReviews.mockReset();
    getPublicStats.mockReset();
    channel.mockClear();
    channelOn.mockReset();
    subscribe.mockReset();
    removeChannel.mockReset();
    channelOn.mockImplementation(() => ({ on: channelOn, subscribe }));
    subscribe.mockImplementation(() => ({ on: channelOn, subscribe }));
    removeChannel.mockResolvedValue("ok");
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
    expect(removeChannel).toHaveBeenCalledTimes(1);
  });

  it("refetches ratings when the private realtime refresh broadcast arrives", async () => {
    const initialReviews = [{ stars: 4, category: "Facilities", comment: "Good", created_at: "2026-01-01", full_name: "Tenant" }];
    const updatedReviews = [{ stars: 5, category: "Facilities", comment: "Great", created_at: "2026-01-02", full_name: "Tenant" }];
    getPublicReviews.mockResolvedValueOnce(initialReviews).mockResolvedValue(updatedReviews);
    getPublicStats.mockResolvedValue({ total_rooms: 10, available_rooms: 2, happy_tenants: 5, avg_rating: 4.5 });

    const { result, unmount } = renderHook(() => usePublicHomepageData(60000));

    await waitFor(() => expect(result.current.reviews).toEqual(initialReviews));
    expect(channel).toHaveBeenCalledWith("public:rating-updates", { config: { private: true } });
    expect(channelOn).toHaveBeenCalledWith("broadcast", { event: "ratings_changed" }, expect.any(Function));

    const onRatingsChanged = channelOn.mock.calls.find(([event]) => event === "broadcast")?.[2];
    expect(onRatingsChanged).toBeTypeOf("function");
    onRatingsChanged?.();
    await waitFor(() => expect(result.current.reviews).toEqual(updatedReviews));
    expect(getPublicReviews).toHaveBeenCalledTimes(2);
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
