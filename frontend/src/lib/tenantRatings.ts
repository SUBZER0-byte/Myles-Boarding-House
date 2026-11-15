import { supabase } from "@/lib/supabase";

export interface TenantRating {
  rating_id: number;
  category: string;
  moderation_status: string;
  admin_reply: string | null;
  stars: number;
  comment: string | null;
  created_at: string;
}

interface TenantRatingResponse {
  type: "success" | "error";
  message?: string;
  data?: TenantRating[];
}

async function invokeTenantRatings(body: Record<string, string | number>) {
  const { data, error } = await supabase.functions.invoke<TenantRatingResponse>(
    "tenant-ratings",
    { body },
  );
  if (error) throw error;
  if (!data || data.type !== "success") {
    throw new Error(data?.message || "Could not complete the rating request.");
  }
  return data;
}

export async function listTenantRatings(): Promise<TenantRating[]> {
  const result = await invokeTenantRatings({ action: "list" });
  if (!Array.isArray(result.data)) throw new Error("The rating service returned an invalid list.");
  return result.data;
}

export async function submitTenantRating(input: {
  stars: number;
  category: string;
  comment: string;
}): Promise<void> {
  await invokeTenantRatings({ action: "submit", ...input });
}
