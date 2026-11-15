import { supabase } from "@/lib/supabase";

export interface StayExtensionRequest {
  request_id: number;
  booking_id: number;
  original_check_out_date: string;
  requested_check_out_date: string;
  status: "Pending" | "Approved" | "Rejected";
  created_at: string;
  full_name: string;
  email: string;
  room_number: string | null;
  monthly_rent: number | string | null;
}

interface StayExtensionResponse<T = unknown> {
  type: "success" | "error";
  message?: string;
  data?: T;
}

async function invokeStayExtension<T = unknown>(
  action: "tenant_request" | "admin_list" | "admin_decide",
  data: Record<string, unknown> = {},
): Promise<StayExtensionResponse<T>> {
  const { data: response, error } = await supabase.functions.invoke<StayExtensionResponse<T>>(
    "stay-extensions",
    { body: { action, data } },
  );
  if (error) throw error;
  if (!response || response.type !== "success") {
    throw new Error(response?.message || "Could not complete the stay extension request.");
  }
  return response;
}

export async function requestStayExtension(requestedCheckOutDate: string): Promise<string> {
  const response = await invokeStayExtension("tenant_request", {
    requested_check_out_date: requestedCheckOutDate,
  });
  return response.message || "Stay extension request submitted for admin approval.";
}

export async function listStayExtensionRequests(): Promise<StayExtensionRequest[]> {
  const response = await invokeStayExtension<StayExtensionRequest[]>("admin_list");
  if (!Array.isArray(response.data)) {
    throw new Error("The stay extension service returned an invalid list.");
  }
  return response.data;
}

export async function decideStayExtension(
  requestId: number,
  decision: "Approved" | "Rejected",
): Promise<string> {
  const response = await invokeStayExtension("admin_decide", {
    request_id: requestId,
    decision,
  });
  return response.message || "Stay extension decision saved.";
}
