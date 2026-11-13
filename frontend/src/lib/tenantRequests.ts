import { supabase } from "@/lib/supabase";

export interface RequestStatusHistory {
  status: string;
  changed_at: string;
  changed_by_name: string | null;
}

export interface TenantComplaint {
  complaint_id: number;
  tenant_id: number;
  full_name?: string;
  room_number?: string | null;
  title: string;
  description: string;
  category: string;
  is_urgent: number;
  photo_path: string | null;
  photo_url?: string | null;
  status: string;
  admin_reply: string | null;
  created_at: string;
  status_history?: RequestStatusHistory[];
}

export interface TenantMaintenanceRequest {
  request_id: number;
  tenant_id: number;
  full_name?: string;
  room_number?: string | null;
  title: string;
  category: string;
  description: string;
  priority: string;
  status: string;
  photo_path: string | null;
  photo_url?: string | null;
  created_at: string;
  status_history?: RequestStatusHistory[];
}

export interface RecurringComplaint {
  category: string;
  room_number: string;
  complaint_count: number | string;
  latest_report: string;
}

interface TenantRequestResponse<T = unknown> {
  type: "success" | "error";
  message?: string;
  data?: T;
  [key: string]: unknown;
}

async function invokeRequest<T = unknown>(
  action: string,
  data: Record<string, unknown> = {},
): Promise<TenantRequestResponse<T>> {
  const { data: response, error } = await supabase.functions.invoke<TenantRequestResponse<T>>(
    "tenant-requests",
    { body: { action, data } },
  );
  if (error) {
    if ("context" in error && error.context instanceof Response) {
      try {
        const body = await error.context.clone().json() as { message?: unknown };
        if (typeof body.message === "string") throw new Error(body.message);
      } catch (contextError) {
        if (contextError instanceof Error && contextError.message !== "Unexpected end of JSON input") {
          throw contextError;
        }
      }
    }
    throw error;
  }
  if (!response || response.type !== "success") {
    throw new Error(response?.message || "Could not complete the request.");
  }
  return response;
}

async function uploadRequestPhoto(file: File): Promise<string> {
  if (
    !["image/jpeg", "image/png", "image/webp"].includes(file.type)
    || file.size <= 0
    || file.size > 10 * 1024 * 1024
  ) {
    throw new Error("Photo must be JPG, PNG, or WEBP and 10MB or smaller.");
  }
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw new Error(userError.message || "Could not verify your account.");
  if (!userData.user) throw new Error("Sign in to attach a photo.");

  const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${userData.user.id}/${crypto.randomUUID()}.${extension}`;
  const { error } = await supabase.storage
    .from("mbh-request-photos")
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw new Error(error.message || "Could not upload the request photo.");
  return path;
}

async function createRequest(
  action: "tenant_create_complaint" | "tenant_create_maintenance",
  data: Record<string, unknown>,
  photo: File | null,
): Promise<TenantRequestResponse> {
  const photoPath = photo ? await uploadRequestPhoto(photo) : null;
  try {
    return await invokeRequest(action, { ...data, photo_path: photoPath });
  } catch (error) {
    if (photoPath) {
      try {
        await invokeRequest("cleanup_photo", { photo_path: photoPath });
      } catch (cleanupError) {
        console.error("Could not clean up an unused request photo:", cleanupError);
      }
    }
    throw error;
  }
}

export async function listTenantComplaints(): Promise<TenantComplaint[]> {
  const response = await invokeRequest<TenantComplaint[]>("tenant_list_complaints");
  if (!Array.isArray(response.data)) throw new Error("The complaint service returned an invalid list.");
  return response.data;
}

export async function createTenantComplaint(input: {
  title: string;
  description: string;
  category: string;
  is_urgent: boolean;
}, photo: File | null): Promise<TenantRequestResponse> {
  return createRequest("tenant_create_complaint", input, photo);
}

export async function createTenantRoomChangeRequest(
  requestedRoomId: number,
  reason: string,
): Promise<string> {
  const response = await invokeRequest("tenant_create_room_change", {
    requested_room_id: requestedRoomId,
    reason,
  });
  return response.message || "Request submitted.";
}

export async function cancelTenantComplaint(complaintId: number): Promise<void> {
  await invokeRequest("tenant_cancel_complaint", { complaint_id: complaintId });
}

export async function listAdminComplaints(): Promise<TenantComplaint[]> {
  const response = await invokeRequest<TenantComplaint[]>("admin_list_complaints");
  if (!Array.isArray(response.data)) throw new Error("The complaint service returned an invalid list.");
  return response.data;
}

export async function listRecurringComplaints(): Promise<RecurringComplaint[]> {
  const response = await invokeRequest<RecurringComplaint[]>("admin_recurring_complaints");
  if (!Array.isArray(response.data)) throw new Error("The recurring complaint service returned an invalid list.");
  return response.data;
}

export async function updateComplaintStatus(complaintId: number, status: string): Promise<void> {
  await invokeRequest("admin_update_complaint_status", { complaint_id: complaintId, status });
}

export async function replyToComplaint(complaintId: number, reply: string): Promise<string> {
  const response = await invokeRequest("admin_reply_complaint", { complaint_id: complaintId, reply });
  return response.message || "Reply sent.";
}

export async function deleteComplaint(complaintId: number): Promise<string> {
  const response = await invokeRequest("admin_delete_complaint", { complaint_id: complaintId });
  return response.message || "Deleted.";
}

export async function listTenantMaintenanceRequests(): Promise<TenantMaintenanceRequest[]> {
  const response = await invokeRequest<TenantMaintenanceRequest[]>("tenant_list_maintenance");
  if (!Array.isArray(response.data)) throw new Error("The maintenance service returned an invalid list.");
  return response.data;
}

export async function createTenantMaintenanceRequest(input: {
  title: string;
  category: string;
  description: string;
  priority: string;
}, photo: File | null): Promise<void> {
  await createRequest("tenant_create_maintenance", input, photo);
}

export async function cancelTenantMaintenanceRequest(requestId: number): Promise<void> {
  await invokeRequest("tenant_cancel_maintenance", { request_id: requestId });
}

export async function listAdminMaintenanceRequests(): Promise<TenantMaintenanceRequest[]> {
  const response = await invokeRequest<TenantMaintenanceRequest[]>("admin_list_maintenance");
  if (!Array.isArray(response.data)) throw new Error("The maintenance service returned an invalid list.");
  return response.data;
}

export async function updateMaintenanceStatus(requestId: number, status: string): Promise<void> {
  await invokeRequest("admin_update_maintenance_status", { request_id: requestId, status });
}

export async function deleteMaintenanceRequest(requestId: number): Promise<string> {
  const response = await invokeRequest("admin_delete_maintenance", { request_id: requestId });
  return response.message || "Deleted.";
}
