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
  deleteAdminPromotionalVideoReply,
  deleteMyPromotionalVideoComment,
  deleteMyPromotionalVideoReply,
  getPromotionalVideoDiscussion,
  listAdminPromotionalVideo,
  saveAdminPromotionalVideoUrl,
  togglePromotionalVideoDiscussionLike,
  togglePromotionalVideoLike,
  updateMyPromotionalVideoComment,
  updateMyPromotionalVideoReply,
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
        likes_count: 2,
        liked_by_me: true,
        replies: [{
          reply_id: 4,
          full_name: "Another Guest",
          reply: "I agree!",
          created_at: "2026-11-18T13:00:00Z",
          is_mine: false,
          likes_count: 1,
          liked_by_me: false,
        }],
      }],
    };
    rpc.mockResolvedValue({ data: discussion, error: null });

    await expect(getPromotionalVideoDiscussion()).resolves.toEqual(discussion);
    expect(rpc).toHaveBeenCalledWith("get_promotional_video_discussion");
  });

  it("loads comments from the previous discussion response and derives Like counts", async () => {
    rpc.mockResolvedValue({
      data: {
        video_url: "https://www.youtube.com/watch?v=abcdefghijk",
        likes_count: 7,
        comments_count: 1,
        liked_by_me: false,
        comments: [{
          comment_id: 3,
          full_name: "Video Guest",
          comment: "Looks great!",
          created_at: "2026-11-18T12:00:00Z",
          is_mine: false,
          replies_count: 1,
          reactions: [
            { reaction: "like", count: 2, reacted_by_me: true },
            { reaction: "love", count: 1, reacted_by_me: false },
          ],
          replies: [{
            reply_id: 4,
            full_name: "Another Guest",
            reply: "I agree!",
            created_at: "2026-11-18T13:00:00Z",
            is_mine: false,
            reactions: [],
          }],
        }],
      },
      error: null,
    });

    await expect(getPromotionalVideoDiscussion()).resolves.toMatchObject({
      comments: [{
        likes_count: 2,
        liked_by_me: true,
        replies: [{ likes_count: 0, liked_by_me: false }],
      }],
    });
  });

  it("masks existing comments and replies from the public discussion read", async () => {
    rpc.mockResolvedValue({
      data: {
        video_url: "",
        likes_count: 0,
        comments_count: 1,
        liked_by_me: false,
        comments: [{
          comment_id: 3,
          full_name: "Video Guest",
          comment: "Gagoooo!",
          created_at: "2026-11-18T12:00:00Z",
          is_mine: false,
          replies_count: 1,
          likes_count: 0,
          liked_by_me: false,
          replies: [{
            reply_id: 4,
            full_name: "Another Guest",
            reply: "sh1t.",
            created_at: "2026-11-18T13:00:00Z",
            is_mine: false,
            likes_count: 0,
            liked_by_me: false,
          }],
        }],
      },
      error: null,
    });

    await expect(getPromotionalVideoDiscussion()).resolves.toMatchObject({
      comments: [{
        comment: "*******!",
        replies: [{ reply: "****." }],
      }],
    });
  });

  it("masks comments before posting without accepting a client-supplied user ID", async () => {
    rpc.mockResolvedValue({ data: { type: "success", comment_id: 9 }, error: null });

    await expect(addPromotionalVideoComment("  Nice f.u.c.k!  ")).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledWith("add_promotional_video_comment", {
      p_comment: "Nice *.*.*.*!",
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
        likes_count: 0,
      }],
      replies: [{
        reply_id: 9,
        comment_id: 8,
        full_name: "Replying User",
        username: "replying",
        reply: "A useful detail",
        created_at: "2026-11-18T13:00:00Z",
        likes_count: 0,
        comment: "A nice place",
        commenter_name: "Guest User",
      }],
      likes: [{
        user_id: 3,
        full_name: "Guest User",
        username: "guest",
        created_at: "2026-11-18T12:00:00Z",
      }],
    };
    const landingDiscussion = {
      video_url: "https://youtu.be/abcdefghijk",
      likes_count: 7,
      comments_count: 1,
      liked_by_me: false,
      comments: [{
        comment_id: 8,
        full_name: "Guest User",
        comment: "A nice place",
        created_at: "2026-11-18T12:00:00Z",
        is_mine: false,
        replies_count: 1,
        reactions: [{ reaction: "like", count: 2, reacted_by_me: false }],
        replies: [{
          reply_id: 9,
          full_name: "Replying User",
          reply: "A useful detail",
          created_at: "2026-11-18T13:00:00Z",
          is_mine: false,
          reactions: [{ reaction: "like", count: 1, reacted_by_me: false }],
        }],
      }],
    };
    rpc.mockResolvedValueOnce({
      data: { type: "success", data: managementData },
      error: null,
    });
    rpc.mockResolvedValueOnce({
      data: { type: "success", replies: managementData.replies },
      error: null,
    });
    rpc.mockResolvedValueOnce({ data: landingDiscussion, error: null });

    await expect(listAdminPromotionalVideo()).resolves.toEqual({
      ...managementData,
      comments: [{ ...managementData.comments[0], likes_count: 2 }],
      replies: [{ ...managementData.replies[0], likes_count: 1 }],
    });
    expect(rpc).toHaveBeenCalledWith("manage_admin_promotional_video", {
      p_action: "list",
      p_data: {},
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "manage_admin_promotional_video_replies", {
      p_action: "list",
      p_data: {},
    });
    expect(rpc).toHaveBeenNthCalledWith(3, "get_promotional_video_discussion");

    rpc.mockResolvedValue({ data: { type: "success", message: "Saved." }, error: null });
    await saveAdminPromotionalVideoUrl(" https://youtu.be/abcdefghijk ");
    await deleteAdminPromotionalVideoComment(8);
    await deleteAdminPromotionalVideoReply(9);
    await deleteAdminPromotionalVideoLike(3);
    expect(rpc).toHaveBeenNthCalledWith(4, "manage_admin_promotional_video", {
      p_action: "save_video_url",
      p_data: { video_url: "https://youtu.be/abcdefghijk" },
    });
    expect(rpc).toHaveBeenNthCalledWith(5, "manage_admin_promotional_video", {
      p_action: "delete_comment",
      p_data: { comment_id: 8 },
    });
    expect(rpc).toHaveBeenNthCalledWith(6, "manage_admin_promotional_video_replies", {
      p_action: "delete",
      p_data: { reply_id: 9 },
    });
    expect(rpc).toHaveBeenNthCalledWith(7, "manage_admin_promotional_video", {
      p_action: "delete_like",
      p_data: { user_id: 3 },
    });
  });

  it("masks authenticated owner comment edits and validates them", async () => {
    rpc.mockResolvedValue({ data: { type: "success", message: "Saved." }, error: null });
    await updateMyPromotionalVideoComment(12, "  Updated f.u.c.k  ");
    await deleteMyPromotionalVideoComment(12);

    expect(rpc).toHaveBeenNthCalledWith(1, "update_my_promotional_video_comment", {
      p_comment_id: 12,
      p_comment: "Updated *.*.*.*",
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "delete_my_promotional_video_comment", {
      p_comment_id: 12,
    });

    rpc.mockClear();
    await expect(updateMyPromotionalVideoComment(12, "  ")).rejects.toThrow("between 1 and 1,000");
    await expect(updateMyPromotionalVideoComment(12, "x".repeat(1001))).rejects.toThrow("between 1 and 1,000");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("masks replies before posting and validates their length", async () => {
    rpc.mockResolvedValue({ data: { type: "success", reply_id: 15 }, error: null });
    await expect(addPromotionalVideoReply(3, "  I agree, sh1t!  ")).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledWith("add_promotional_video_reply", {
      p_comment_id: 3,
      p_reply: "I agree, ****!",
    });

    rpc.mockClear();
    await expect(addPromotionalVideoReply(3, " ")).rejects.toThrow("between 1 and 1,000");
    await expect(addPromotionalVideoReply(3, "x".repeat(1001))).rejects.toThrow("between 1 and 1,000");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("masks owner reply edits and validates them", async () => {
    rpc.mockResolvedValue({ data: { type: "success", message: "Saved." }, error: null });
    await updateMyPromotionalVideoReply(15, "  Updated sh1t  ");
    await deleteMyPromotionalVideoReply(15);

    expect(rpc).toHaveBeenNthCalledWith(1, "update_my_promotional_video_reply", {
      p_reply_id: 15,
      p_reply: "Updated ****",
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "delete_my_promotional_video_reply", {
      p_reply_id: 15,
    });

    rpc.mockClear();
    await expect(updateMyPromotionalVideoReply(15, "  ")).rejects.toThrow("between 1 and 1,000");
    await expect(updateMyPromotionalVideoReply(15, "x".repeat(1001))).rejects.toThrow("between 1 and 1,000");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("toggles a like on either a comment or a reply through the authenticated RPC", async () => {
    rpc.mockResolvedValue({ data: { type: "success", active: true, likes_count: 1 }, error: null });
    await expect(togglePromotionalVideoDiscussionLike("comment", 3)).resolves.toBeUndefined();
    expect(rpc).toHaveBeenNthCalledWith(1, "toggle_promotional_video_discussion_like", {
      p_target_type: "comment",
      p_target_id: 3,
    });

    await togglePromotionalVideoDiscussionLike("reply", 4);
    expect(rpc).toHaveBeenNthCalledWith(2, "toggle_promotional_video_discussion_like", {
      p_target_type: "reply",
      p_target_id: 4,
    });
  });

  it("falls back to the previous Like reaction RPC when the new RPC is unavailable", async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "PGRST202", message: "New like RPC is unavailable." },
    });
    rpc.mockResolvedValueOnce({
      data: { type: "success", active: true },
      error: null,
    });

    await expect(togglePromotionalVideoDiscussionLike("comment", 3)).resolves.toBeUndefined();
    expect(rpc).toHaveBeenNthCalledWith(1, "toggle_promotional_video_discussion_like", {
      p_target_type: "comment",
      p_target_id: 3,
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "toggle_promotional_video_reaction", {
      p_target_type: "comment",
      p_target_id: 3,
      p_reaction: "like",
    });
  });
});
