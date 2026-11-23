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

export interface CancellationSmsNotificationResult {
  status: "sent" | "partial" | "failed" | "in_progress";
  sent: number;
  failed: number;
  message?: string;
}

type CancellationSmsAction =
  | "cancellation_submitted"
  | "cancellation_approved"
  | "cancellation_rejected";

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

async function callWithoutData(action: string, data: Record<string, unknown> = {}): Promise<void> {
  const { data: response, error } = await supabase.rpc("manage_tenant_cancellation", {
    p_action: action,
    p_data: data,
  });
  if (error) throw new Error(error.message || "Could not process the cancellation request.");
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    throw new Error("The cancellation service returned an invalid response.");
  }
  const result = response as RpcResponse<unknown>;
  if (result.type !== "success") {
    throw new Error(result.message || "Could not process the cancellation request.");
  }
}

async function notifyCancellationSms(
  action: CancellationSmsAction,
  cancellationId: number,
): Promise<CancellationSmsNotificationResult> {
  try {
    const { data, error } = await supabase.functions.invoke<CancellationSmsNotificationResult>(
      "cancellation-sms-notifications",
      { body: { action, cancellation_id: cancellationId } },
    );
    if (error) throw new Error(error.message || "Could not send cancellation SMS notifications.");
    if (
      !data
      || !["sent", "partial", "failed", "in_progress"].includes(data.status)
      || !Number.isSafeInteger(data.sent)
      || data.sent < 0
      || !Number.isSafeInteger(data.failed)
      || data.failed < 0
    ) {
      throw new Error("The cancellation SMS service returned an invalid response.");
    }
    return data;
  } catch (error) {
    console.error("Cancellation SMS notification failed:", error);
    return {
      status: "failed",
      sent: 0,
      failed: 1,
      message: error instanceof Error ? error.message : "Could not send cancellation SMS notifications.",
    };
  }
}

export function getMyCancellationPreview() {
  return call<CancellationPreview>("tenant_preview");
}

export function getMyCancellationStatus() {
  return call<TenantCancellationStatus | null>("tenant_status");
}

export async function submitMyCancellationRequest() {
  const submitted = await call<{ cancellation_id: number; expires_at: string }>("tenant_request");
  if (!Number.isSafeInteger(submitted.cancellation_id) || submitted.cancellation_id <= 0) {
    throw new Error("The cancellation service returned an invalid request ID.");
  }
  const sms = await notifyCancellationSms("cancellation_submitted", submitted.cancellation_id);
  return { ...submitted, sms };
}

export async function withdrawMyCancellationRequest(cancellationId: number) {
  await callWithoutData("tenant_withdraw", { cancellation_id: cancellationId });
}

export function getAdminCancellations(status: string) {
  if (status !== "all" && !["Pending", "Approved", "Rejected", "Withdrawn", "Expired"].includes(status)) {
    throw new Error("Invalid cancellation status filter.");
  }
  return call<AdminCancellationRequest[]>("admin_list", { status });
}

export async function approveTenantCancellation(cancellationId: number) {
  if (!Number.isSafeInteger(cancellationId) || cancellationId <= 0) {
    throw new Error("A valid cancellation request ID is required.");
  }
  await callWithoutData("admin_approve", { cancellation_id: cancellationId });
  return notifyCancellationSms("cancellation_approved", cancellationId);
}

export async function rejectTenantCancellation(cancellationId: number, reason: string) {
  if (!Number.isSafeInteger(cancellationId) || cancellationId <= 0) {
    throw new Error("A valid cancellation request ID is required.");
  }
  const trimmedReason = reason.trim();
  if (!trimmedReason || trimmedReason.length > 2000) {
    throw new Error("Enter a rejection reason of no more than 2000 characters.");
  }
  await callWithoutData("admin_reject", { cancellation_id: cancellationId, rejection_reason: trimmedReason });
  return notifyCancellationSms("cancellation_rejected", cancellationId);
}
