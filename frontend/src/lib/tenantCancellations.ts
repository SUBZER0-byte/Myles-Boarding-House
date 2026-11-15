import { supabase } from "@/lib/supabase";

export type CancellationStatus = "Pending" | "Approved" | "Rejected" | "Withdrawn" | "Expired";

export interface CancellationPreview {
  full_name: string;
  room_number: string;
  monthly_rent: number;
  daily_rate: number;
  move_in_date: string;
  cancellation_date: string;
  calculated_at: string;
  days_consumed: number;
  amount_used: number;
  refund_amount: number;
}

export interface TenantCancellationStatus {
  cancellation_id: number;
  status: CancellationStatus;
  cancellation_expires_at: string;
  cancellation_date: string;
  days_consumed: number;
  refund_amount: number;
  daily_rate: number;
  amount_used: number;
  monthly_rent: number;
  move_in_date: string;
  room_number: string;
  rejection_reason: string | null;
}

export interface AdminCancellationRequest extends TenantCancellationStatus {
  tenant_id: number;
  tenant_name: string;
  tenant_email: string;
  tenant_phone: string;
  created_at: string;
}

interface RpcResponse<T> {
  type: "success" | "error";
  message?: string;
  data?: T;
}

async function call<T>(action: string, data: Record<string, unknown> = {}): Promise<T> {
  const { data: response, error } = await supabase.rpc("manage_tenant_cancellation", {
    p_action: action,
    p_data: data,
  });
  if (error) throw new Error(error.message || "Could not process the cancellation request.");
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    throw new Error("The cancellation service returned an invalid response.");
  }
  const result = response as RpcResponse<T>;
  if (result.type !== "success") {
    throw new Error(result.message || "Could not process the cancellation request.");
  }
  if (!Object.prototype.hasOwnProperty.call(result, "data")) {
    throw new Error("The cancellation service returned an incomplete response.");
  }
  return result.data as T;
}

export function getMyCancellationPreview() {
  return call<CancellationPreview>("tenant_preview");
}

export function getMyCancellationStatus() {
  return call<TenantCancellationStatus | null>("tenant_status");
}

export function submitMyCancellationRequest() {
  return call<{ cancellation_id: number; expires_at: string }>("tenant_request");
}

export function withdrawMyCancellationRequest(cancellationId: number) {
  return call<null>("tenant_withdraw", { cancellation_id: cancellationId });
}

export function getAdminCancellations(status: string) {
  if (status !== "all" && !["Pending", "Approved", "Rejected", "Withdrawn", "Expired"].includes(status)) {
    throw new Error("Invalid cancellation status filter.");
  }
  return call<AdminCancellationRequest[]>("admin_list", { status });
}

export function approveTenantCancellation(cancellationId: number) {
  return call<null>("admin_approve", { cancellation_id: cancellationId });
}

export function rejectTenantCancellation(cancellationId: number, reason: string) {
  const trimmedReason = reason.trim();
  if (!trimmedReason || trimmedReason.length > 2000) {
    throw new Error("Enter a rejection reason of no more than 2000 characters.");
  }
  return call<null>("admin_reject", { cancellation_id: cancellationId, rejection_reason: trimmedReason });
}
