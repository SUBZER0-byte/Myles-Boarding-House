// Runtime validation coverage for persistent promotional video comments and likes.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc },
}));

import {
  addPromotionalVideoComment,
  getPromotionalVideoDiscussion,
  togglePromotionalVideoLike,
} from "@/lib/promotionalVideo";

describe("promotional video discussion", () => {
  beforeEach(() => {
    rpc.mockReset();
  });

  it("loads public comments and the current like state", async () => {
    const discussion = {
      likes_count: 7,
      liked_by_me: true,
      comments: [{
        comment_id: 3,
        full_name: "Video Guest",
        comment: "Looks great!",
        created_at: "2026-11-18T12:00:00Z",
      }],
    };
    rpc.mockResolvedValue({ data: discussion, error: null });

    await expect(getPromotionalVideoDiscussion()).resolves.toEqual(discussion);
    expect(rpc).toHaveBeenCalledWith("get_promotional_video_discussion");
  });

  it("posts trimmed comments without accepting a client-supplied user ID", async () => {
    rpc.mockResolvedValue({ data: { type: "success", comment_id: 9 }, error: null });

    await expect(addPromotionalVideoComment("  Nice place!  ")).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledWith("add_promotional_video_comment", {
      p_comment: "Nice place!",
    });
  });

  it("rejects empty or oversized comments before sending the RPC", async () => {
    await expect(addPromotionalVideoComment("  ")).rejects.toThrow("between 1 and 1,000");
    await expect(addPromotionalVideoComment("a".repeat(1001))).rejects.toThrow("between 1 and 1,000");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("toggles likes and surfaces database failures", async () => {
    rpc.mockResolvedValueOnce({
      data: { type: "success", liked: true, likes_count: 8 },
      error: null,
    });
    await expect(togglePromotionalVideoLike()).resolves.toEqual({
      liked: true,
      likes_count: 8,
    });
    expect(rpc).toHaveBeenCalledWith("toggle_promotional_video_like");

    rpc.mockResolvedValueOnce({ data: null, error: new Error("Sign in to like the video") });
    await expect(togglePromotionalVideoLike()).rejects.toThrow("Sign in to like the video");
  });
});
