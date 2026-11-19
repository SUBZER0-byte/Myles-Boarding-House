// Runtime validation coverage for persistent promotional video comments and likes.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc },
}));

import {
  addPromotionalVideoComment,
  addPromotionalVideoReply,
  deleteAdminPromotionalVideoComment,
  deleteAdminPromotionalVideoLike,
  deleteMyPromotionalVideoComment,
  getPromotionalVideoDiscussion,
  listAdminPromotionalVideo,
  saveAdminPromotionalVideoUrl,
  togglePromotionalVideoLike,
  updateMyPromotionalVideoComment,
} from "@/lib/promotionalVideo";

describe("promotional video discussion", () => {
  beforeEach(() => {
    rpc.mockReset();
  });

  it("loads public comments and the current like state", async () => {
    const discussion = {
      video_url: "https://www.youtube.com/watch?v=abcdefghijk",
      likes_count: 7,
      comments_count: 1,
      liked_by_me: true,
      comments: [{
        comment_id: 3,
        full_name: "Video Guest",
        comment: "Looks great!",
        created_at: "2026-11-18T12:00:00Z",
        is_mine: false,
        replies_count: 1,
        replies: [{
          reply_id: 4,
          full_name: "Another Guest",
          reply: "I agree!",
          created_at: "2026-11-18T13:00:00Z",
          is_mine: false,
        }],
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

  it("loads admin comments and likes and routes moderation actions through the admin RPC", async () => {
    const managementData = {
      video_url: "https://youtu.be/abcdefghijk",
      comments: [{
        comment_id: 8,
        user_id: 3,
        full_name: "Guest User",
        username: "guest",
        comment: "A nice place",
        created_at: "2026-11-18T12:00:00Z",
      }],
      likes: [{
        user_id: 3,
        full_name: "Guest User",
        username: "guest",
        created_at: "2026-11-18T12:00:00Z",
      }],
    };
    rpc.mockResolvedValueOnce({
      data: { type: "success", data: managementData },
      error: null,
    });

    await expect(listAdminPromotionalVideo()).resolves.toEqual(managementData);
    expect(rpc).toHaveBeenCalledWith("manage_admin_promotional_video", {
      p_action: "list",
      p_data: {},
    });

    rpc.mockResolvedValue({ data: { type: "success", message: "Saved." }, error: null });
    await saveAdminPromotionalVideoUrl(" https://youtu.be/abcdefghijk ");
    await deleteAdminPromotionalVideoComment(8);
    await deleteAdminPromotionalVideoLike(3);
    expect(rpc).toHaveBeenNthCalledWith(2, "manage_admin_promotional_video", {
      p_action: "save_video_url",
      p_data: { video_url: "https://youtu.be/abcdefghijk" },
    });
    expect(rpc).toHaveBeenNthCalledWith(3, "manage_admin_promotional_video", {
      p_action: "delete_comment",
      p_data: { comment_id: 8 },
    });
    expect(rpc).toHaveBeenNthCalledWith(4, "manage_admin_promotional_video", {
      p_action: "delete_like",
      p_data: { user_id: 3 },
    });
  });

  it("uses authenticated owner-only comment RPCs and validates edits", async () => {
    rpc.mockResolvedValue({ data: { type: "success", message: "Saved." }, error: null });
    await updateMyPromotionalVideoComment(12, "  Updated text  ");
    await deleteMyPromotionalVideoComment(12);

    expect(rpc).toHaveBeenNthCalledWith(1, "update_my_promotional_video_comment", {
      p_comment_id: 12,
      p_comment: "Updated text",
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "delete_my_promotional_video_comment", {
      p_comment_id: 12,
    });

    rpc.mockClear();
    await expect(updateMyPromotionalVideoComment(12, "  ")).rejects.toThrow("between 1 and 1,000");
    await expect(updateMyPromotionalVideoComment(12, "x".repeat(1001))).rejects.toThrow("between 1 and 1,000");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("posts replies through the authenticated comment-reply RPC and validates their length", async () => {
    rpc.mockResolvedValue({ data: { type: "success", reply_id: 15 }, error: null });
    await expect(addPromotionalVideoReply(3, "  I agree!  ")).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledWith("add_promotional_video_reply", {
      p_comment_id: 3,
      p_reply: "I agree!",
    });

    rpc.mockClear();
    await expect(addPromotionalVideoReply(3, " ")).rejects.toThrow("between 1 and 1,000");
    await expect(addPromotionalVideoReply(3, "x".repeat(1001))).rejects.toThrow("between 1 and 1,000");
    expect(rpc).not.toHaveBeenCalled();
  });
});
