import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc },
}));

import { getPublicReviews, getPublicStats } from "@/lib/publicHomepage";

describe("public homepage reads", () => {
  beforeEach(() => {
    rpc.mockReset();
  });

  it("uses the reviews RPC and returns only its public fields", async () => {
    const reviews = [{ stars: 4.5, category: "Facilities", comment: "Great", created_at: "2026-01-01", full_name: null }];
    rpc.mockResolvedValue({ data: reviews, error: null });

    await expect(getPublicReviews()).resolves.toEqual(reviews);
    expect(rpc).toHaveBeenCalledWith("get_public_reviews");
  });

  it("reads the single aggregate stats row", async () => {
    const stats = { total_rooms: 10, available_rooms: 2, happy_tenants: 5, avg_rating: 4.25 };
    rpc.mockResolvedValue({ data: [stats], error: null });

    await expect(getPublicStats()).resolves.toEqual(stats);
    expect(rpc).toHaveBeenCalledWith("get_public_stats");
  });

  it("propagates RPC errors", async () => {
    const failure = new Error("RPC unavailable");
    rpc.mockResolvedValue({ data: null, error: failure });

    await expect(getPublicReviews()).rejects.toBe(failure);
  });
});
