import { supabase } from "@/lib/supabase";

export interface PromotionalVideoComment {
  comment_id: number;
  full_name: string;
  comment: string;
  created_at: string;
}

export interface PromotionalVideoDiscussion {
  likes_count: number;
  liked_by_me: boolean;
  comments: PromotionalVideoComment[];
}

interface DiscussionResponse {
  likes_count: number;
  liked_by_me: boolean;
  comments: PromotionalVideoComment[];
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
      ) {
        throw new Error("The video discussion service returned an invalid comment.");
      }
      return {
        comment_id: item.comment_id,
        full_name: item.full_name,
        comment: item.comment,
        created_at: item.created_at,
      };
    })
    : null;
  if (
    !isRecord(data)
    || typeof data.likes_count !== "number"
    || typeof data.liked_by_me !== "boolean"
    || !comments
  ) {
    throw new Error("The video discussion service returned invalid data.");
  }
  return {
    likes_count: data.likes_count,
    liked_by_me: data.liked_by_me,
    comments,
  };
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
