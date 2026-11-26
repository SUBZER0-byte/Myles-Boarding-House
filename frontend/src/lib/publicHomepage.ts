import { supabase } from "@/lib/supabase";
import { filterProfanity } from "@/lib/profanityFilter";

export interface PublicReview {
  stars: number;
  category: string;
  comment: string | null;
  created_at: string;
  full_name: string | null;
  room_number: string | null;
}

export interface PublicStats {
  total_rooms: number;
  available_rooms: number;
  happy_tenants: number;
  avg_rating: number;
}

export async function getPublicReviews(): Promise<PublicReview[]> {
  const { data, error } = await supabase.rpc("get_public_reviews");
  if (error) throw error;
  return ((data ?? []) as PublicReview[]).map(review => ({
    ...review,
    comment: review.comment === null ? null : filterProfanity(review.comment),
  }));
}

export async function getPublicStats(): Promise<PublicStats> {
  const { data, error } = await supabase.rpc("get_public_stats");
  if (error) throw error;
  const stats = (data ?? [])[0] as PublicStats | undefined;
  if (!stats) throw new Error("Public homepage statistics are unavailable.");
  return stats;
}
