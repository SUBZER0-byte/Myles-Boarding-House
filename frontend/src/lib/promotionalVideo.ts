import { supabase } from "@/lib/supabase";

export interface PromotionalVideoComment {
  comment_id: number;
  full_name: string;
  comment: string;
  created_at: string;
  is_mine: boolean;
  replies_count: number;
  reactions: PromotionalVideoReaction[];
  replies: PromotionalVideoReply[];
}

export type PromotionalVideoReactionType = "like" | "love" | "haha" | "wow" | "sad" | "angry";

export interface PromotionalVideoReaction {
  reaction: PromotionalVideoReactionType;
  count: number;
  reacted_by_me: boolean;
}

export interface PromotionalVideoReply {
  reply_id: number;
  full_name: string;
  reply: string;
  created_at: string;
  is_mine: boolean;
  reactions: PromotionalVideoReaction[];
}

export interface PromotionalVideoDiscussion {
  video_url: string;
  likes_count: number;
  comments_count: number;
  liked_by_me: boolean;
  comments: PromotionalVideoComment[];
}

export interface PromotionalVideoAdminComment extends Omit<PromotionalVideoComment, "is_mine"> {
  user_id: number;
  username: string;
}

export interface PromotionalVideoAdminLike {
  user_id: number;
  full_name: string;
  username: string;
  created_at: string;
}

export interface PromotionalVideoAdminData {
  video_url: string;
  comments: PromotionalVideoAdminComment[];
  likes: PromotionalVideoAdminLike[];
}

interface ActionResponse {
  type: "success" | "error";
  message?: string;
  comment_id?: number;
  liked?: boolean;
  likes_count?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const reactionTypes: readonly string[] = ["like", "love", "haha", "wow", "sad", "angry"];

function isReactionType(value: string): value is PromotionalVideoReactionType {
  return reactionTypes.includes(value);
}

function parseReactions(value: unknown): PromotionalVideoReaction[] {
  if (!Array.isArray(value)) {
    throw new Error("The video discussion service returned invalid reactions.");
  }
  return value.map((item): PromotionalVideoReaction => {
    if (
      !isRecord(item)
      || typeof item.reaction !== "string"
      || !isReactionType(item.reaction)
      || typeof item.count !== "number"
      || typeof item.reacted_by_me !== "boolean"
    ) {
      throw new Error("The video discussion service returned an invalid reaction.");
    }
    return {
      reaction: item.reaction,
      count: item.count,
      reacted_by_me: item.reacted_by_me,
    };
  });
}

export async function getPromotionalVideoDiscussion(): Promise<PromotionalVideoDiscussion> {
  const { data, error } = await supabase.rpc("get_promotional_video_discussion");
  if (error) throw new Error(error.message || "Could not load video comments and likes.");
  const comments = isRecord(data) && Array.isArray(data.comments)
    ? data.comments.map((item): PromotionalVideoComment => {
      if (
        !isRecord(item)
        || typeof item.comment_id !== "number"
        || typeof item.full_name !== "string"
        || typeof item.comment !== "string"
        || typeof item.created_at !== "string"
        || typeof item.is_mine !== "boolean"
        || typeof item.replies_count !== "number"
        || !Array.isArray(item.reactions)
        || !Array.isArray(item.replies)
      ) {
        throw new Error("The video discussion service returned an invalid comment.");
      }
      const replies = item.replies.map((reply): PromotionalVideoReply => {
        if (
          !isRecord(reply)
          || typeof reply.reply_id !== "number"
          || typeof reply.full_name !== "string"
          || typeof reply.reply !== "string"
          || typeof reply.created_at !== "string"
          || typeof reply.is_mine !== "boolean"
          || !Array.isArray(reply.reactions)
        ) {
          throw new Error("The video discussion service returned an invalid reply.");
        }
        return {
          reply_id: reply.reply_id,
          full_name: reply.full_name,
          reply: reply.reply,
          created_at: reply.created_at,
          is_mine: reply.is_mine,
          reactions: parseReactions(reply.reactions),
        };
      });
      return {
        comment_id: item.comment_id,
        full_name: item.full_name,
        comment: item.comment,
        created_at: item.created_at,
        is_mine: item.is_mine,
        replies_count: item.replies_count,
        reactions: parseReactions(item.reactions),
        replies,
      };
    })
    : null;
  if (
    !isRecord(data)
    || typeof data.video_url !== "string"
    || typeof data.likes_count !== "number"
    || typeof data.comments_count !== "number"
    || typeof data.liked_by_me !== "boolean"
    || !comments
  ) {
    throw new Error("The video discussion service returned invalid data.");
  }
  return {
    video_url: data.video_url,
    likes_count: data.likes_count,
    comments_count: data.comments_count,
    liked_by_me: data.liked_by_me,
    comments,
  };
}

function assertSuccessResponse(data: unknown, fallback: string): Record<string, unknown> {
  if (!isRecord(data) || data.type !== "success") {
    throw new Error(isRecord(data) && typeof data.message === "string" ? data.message : fallback);
  }
  return data;
}

export async function listAdminPromotionalVideo(): Promise<PromotionalVideoAdminData> {
  const { data, error } = await supabase.rpc("manage_admin_promotional_video", {
    p_action: "list",
    p_data: {},
  });
  if (error) throw new Error(error.message || "Could not load promotional video management.");

  const response = assertSuccessResponse(data, "Could not load promotional video management.");
  const result = response.data;
  if (
    !isRecord(result)
    || typeof result.video_url !== "string"
    || !Array.isArray(result.comments)
    || !Array.isArray(result.likes)
  ) {
    throw new Error("The promotional video management service returned invalid data.");
  }

  const comments = result.comments.map((item): PromotionalVideoAdminComment => {
    if (
      !isRecord(item)
      || typeof item.comment_id !== "number"
      || typeof item.user_id !== "number"
      || typeof item.full_name !== "string"
      || typeof item.username !== "string"
      || typeof item.comment !== "string"
      || typeof item.created_at !== "string"
    ) {
      throw new Error("The promotional video management service returned an invalid comment.");
    }
    return {
      comment_id: item.comment_id,
      user_id: item.user_id,
      full_name: item.full_name,
      username: item.username,
      comment: item.comment,
      created_at: item.created_at,
    };
  });

  const likes = result.likes.map((item): PromotionalVideoAdminLike => {
    if (
      !isRecord(item)
      || typeof item.user_id !== "number"
      || typeof item.full_name !== "string"
      || typeof item.username !== "string"
      || typeof item.created_at !== "string"
    ) {
      throw new Error("The promotional video management service returned an invalid like.");
    }
    return {
      user_id: item.user_id,
      full_name: item.full_name,
      username: item.username,
      created_at: item.created_at,
    };
  });

  return { video_url: result.video_url, comments, likes };
}

async function runAdminVideoAction(
  action: string,
  p_data: Record<string, string | number>,
  fallback: string,
): Promise<string> {
  const { data, error } = await supabase.rpc("manage_admin_promotional_video", {
    p_action: action,
    p_data,
  });
  if (error) throw new Error(error.message || fallback);
  const response = assertSuccessResponse(data, fallback);
  return typeof response.message === "string" ? response.message : "Saved.";
}

export function saveAdminPromotionalVideoUrl(videoUrl: string): Promise<string> {
  return runAdminVideoAction(
    "save_video_url",
    { video_url: videoUrl.trim() },
    "Could not save promotional video URL.",
  );
}

export function deleteAdminPromotionalVideoComment(commentId: number): Promise<string> {
  return runAdminVideoAction(
    "delete_comment",
    { comment_id: commentId },
    "Could not delete the video comment.",
  );
}

export function deleteAdminPromotionalVideoLike(userId: number): Promise<string> {
  return runAdminVideoAction(
    "delete_like",
    { user_id: userId },
    "Could not remove the video like.",
  );
}

async function runMyCommentAction(
  action: "update" | "delete",
  commentId: number,
  comment?: string,
): Promise<string> {
  const commentValue = comment?.trim();
  if (action === "update" && (!commentValue || commentValue.length > 1000)) {
    throw new Error("Comments must be between 1 and 1,000 characters.");
  }
  const { data, error } = action === "update"
    ? await supabase.rpc("update_my_promotional_video_comment", {
      p_comment_id: commentId,
      p_comment: commentValue,
    })
    : await supabase.rpc("delete_my_promotional_video_comment", {
      p_comment_id: commentId,
    });
  if (error) throw new Error(error.message || `Could not ${action} your comment.`);
  const response = assertSuccessResponse(data, `Could not ${action} your comment.`);
  return typeof response.message === "string" ? response.message : "Saved.";
}

export function updateMyPromotionalVideoComment(commentId: number, comment: string): Promise<string> {
  return runMyCommentAction("update", commentId, comment);
}

export function deleteMyPromotionalVideoComment(commentId: number): Promise<string> {
  return runMyCommentAction("delete", commentId);
}

export async function addPromotionalVideoReply(commentId: number, reply: string): Promise<void> {
  const value = reply.trim();
  if (!value || value.length > 1000) {
    throw new Error("Replies must be between 1 and 1,000 characters.");
  }

  const { data, error } = await supabase.rpc("add_promotional_video_reply", {
    p_comment_id: commentId,
    p_reply: value,
  });
  if (error) throw new Error(error.message || "Could not post your reply.");
  if (!isRecord(data) || data.type !== "success" || typeof data.reply_id !== "number") {
    throw new Error(isRecord(data) && typeof data.message === "string"
      ? data.message
      : "The reply service returned an invalid response.");
  }
}

export async function togglePromotionalVideoReaction(
  targetType: "comment" | "reply",
  targetId: number,
  reaction: PromotionalVideoReactionType,
): Promise<void> {
  const { data, error } = await supabase.rpc("toggle_promotional_video_reaction", {
    p_target_type: targetType,
    p_target_id: targetId,
    p_reaction: reaction,
  });
  if (error) throw new Error(error.message || "Could not update your reaction.");
  if (!isRecord(data) || data.type !== "success" || typeof data.active !== "boolean") {
    throw new Error(isRecord(data) && typeof data.message === "string"
      ? data.message
      : "The reaction service returned an invalid response.");
  }
}

export async function addPromotionalVideoComment(comment: string): Promise<void> {
  const value = comment.trim();
  if (!value || value.length > 1000) {
    throw new Error("Comments must be between 1 and 1,000 characters.");
  }
  const { data, error } = await supabase.rpc("add_promotional_video_comment", {
    p_comment: value,
  });
  if (error) throw new Error(error.message || "Could not post your comment.");
  if (!isRecord(data) || data.type !== "success" || typeof data.comment_id !== "number") {
    throw new Error(isRecord(data) && typeof data.message === "string"
      ? data.message
      : "The comment service returned an invalid response.");
  }
}

export async function togglePromotionalVideoLike(): Promise<{
  liked: boolean;
  likes_count: number;
}> {
  const { data, error } = await supabase.rpc("toggle_promotional_video_like");
  if (error) throw new Error(error.message || "Could not update your like.");
  if (
    !isRecord(data)
    || data.type !== "success"
    || typeof data.liked !== "boolean"
    || typeof data.likes_count !== "number"
  ) {
    throw new Error(isRecord(data) && typeof data.message === "string"
      ? data.message
      : "The like service returned an invalid response.");
  }
  return { liked: data.liked, likes_count: data.likes_count };
}
