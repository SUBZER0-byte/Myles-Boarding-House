import { supabase } from "@/lib/supabase";

export interface TenantDashboardData {
  tenant_name: string;
  room_info: { room_id: number; room_number: string; room_type: string; monthly_rent: number; status: string } | null;
  current_balance: number;
  next_due_payment: { payment_id: number; amount: number; due_date: string | null; status: string } | null;
  last_payment: { payment_id: number; amount: number; paid_at: string | null; method: string | null } | null;
  announcements: { announcement_id: number; title: string; body: string; created_at: string }[];
  maintenance: { request_id: number; title: string; status: string; created_at: string }[];
  complaints: { complaint_id: number; title: string; status: string; created_at: string }[];
  maintenance_summary: Record<string, number>;
  complaint_summary: Record<string, number>;
}

interface TenantDashboardResponse {
  type: "success" | "error";
  message?: string;
  data?: TenantDashboardData;
}

export async function getTenantDashboard(): Promise<TenantDashboardData> {
  const { data, error } = await supabase.functions.invoke<TenantDashboardResponse>(
    "tenant-dashboard",
    { body: {} },
  );
  if (error) throw error;
  if (data?.type !== "success" || !data.data) {
    throw new Error(data?.message || "Supabase returned an invalid dashboard response.");
  }
  return data.data;
}
