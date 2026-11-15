import { supabase } from "@/lib/supabase";

export interface AdminAnalyticsData {
  revenue: { month: string; total: number | string }[];
  bookings: { month: string; total: number | string }[];
  occupancy: { month: string; new_tenants: number | string }[];
  complaints: { status: string; cnt: number }[];
  maintenance: { status: string; cnt: number }[];
  top_tenants: { tenant_id: number; full_name: string; total_paid: number | string }[];
}

interface AdminAnalyticsResponse {
  type: "success" | "error";
  message?: string;
  data?: AdminAnalyticsData;
}

export async function getAdminAnalytics(): Promise<AdminAnalyticsData> {
  const { data, error } = await supabase.functions.invoke<AdminAnalyticsResponse>(
    "admin-analytics",
    { body: {} },
  );
  if (error) throw error;
  if (data?.type !== "success" || !data.data) {
    throw new Error(data?.message || "Could not load analytics.");
  }
  return data.data;
}
