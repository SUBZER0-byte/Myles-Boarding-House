import { supabase } from "@/lib/supabase";

export interface AdminRating {
  rating_id: number;
  user_id: number | null;
  profile_picture: string | null;
  full_name: string | null;
  category: string;
  moderation_status: string;
  admin_reply: string | null;
  stars: number;
  comment: string | null;
  created_at: string;
}

export interface AdminRatingSummary {
  total: number;
  average: number | string;
  five: number;
  four_half: number;
  four: number;
  three_half: number;
  three: number;
  two_half: number;
  two: number;
  one_half: number;
  one: number;
}

export interface AdminRatingCategorySummary {
  category: string;
  total: number | string;
  average: number | string;
}

interface AdminRatingsResponse<T = unknown> {
  type: "success" | "error";
  message?: string;
  data?: T;
}

async function invokeAdminRatings<T = unknown>(
  action: "list" | "summary" | "category_summary" | "moderate" | "reply" | "delete",
  data: Record<string, unknown> = {},
): Promise<AdminRatingsResponse<T>> {
  const { data: response, error } = await supabase.functions.invoke<AdminRatingsResponse<T>>(
    "admin-ratings",
    { body: { action, data } },
  );
  if (error) throw error;
  if (!response || response.type !== "success") {
    throw new Error(response?.message || "Could not complete the ratings action.");
  }
  return response;
}

export async function listAdminRatings(): Promise<AdminRating[]> {
  const response = await invokeAdminRatings<AdminRating[]>("list");
  if (!Array.isArray(response.data)) throw new Error("The ratings service returned an invalid list.");
  return response.data;
}

export async function getAdminRatingSummary(): Promise<AdminRatingSummary> {
  const response = await invokeAdminRatings<AdminRatingSummary>("summary");
  if (!response.data || typeof response.data !== "object") {
    throw new Error("The ratings service returned an invalid summary.");
  }
  return response.data;
}

export async function getAdminRatingCategorySummary(): Promise<AdminRatingCategorySummary[]> {
  const response = await invokeAdminRatings<AdminRatingCategorySummary[]>("category_summary");
  if (!Array.isArray(response.data)) {
    throw new Error("The ratings service returned an invalid category summary.");
  }
  return response.data;
}

export async function moderateAdminRating(
  ratingId: number,
  moderationStatus: "Approved" | "Hidden",
): Promise<string> {
  const response = await invokeAdminRatings("moderate", {
    rating_id: ratingId,
    moderation_status: moderationStatus,
  });
  return response.message || "Moderation updated.";
}

export async function replyToAdminRating(ratingId: number, reply: string): Promise<string> {
  const response = await invokeAdminRatings("reply", { rating_id: ratingId, admin_reply: reply });
  return response.message || "Reply sent.";
}

export async function deleteAdminRating(ratingId: number): Promise<string> {
  const response = await invokeAdminRatings("delete", { rating_id: ratingId });
  return response.message || "Deleted.";
}
