import { supabase } from "@/lib/supabase";

export interface RequestStatusHistory {
  status: string;
  changed_at: string;
  changed_by_name: string | null;
}

export interface ComplaintAttachment {
  attachment_id: number;
  complaint_id: number;
  path: string;
  type: "image" | "video";
  sort_order: number;
  signed_url: string;
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
  attachments?: ComplaintAttachment[];
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

const REQUEST_ATTACHMENT_BUCKET = "mbh-request-photos";
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"];
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const MAX_VIDEO_SIZE = 50 * 1024 * 1024;
const SIGNED_URL_TTL_SECONDS = 300;
const signedAttachmentUrlCache = new Map<string, { url: string; expiresAt: number }>();

export class ComplaintAttachmentSaveError extends Error {
  constructor(public readonly complaintId: number, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : "An unexpected error occurred.";
    super(`Complaint #${complaintId} was filed, but its attachments could not be saved: ${detail}`);
    this.name = "ComplaintAttachmentSaveError";
  }
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
    .from(REQUEST_ATTACHMENT_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw new Error(error.message || "Could not upload the request photo.");
  return path;
}

async function removeUnattachedFiles(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const { error } = await supabase.storage.from(REQUEST_ATTACHMENT_BUCKET).remove(paths);
  if (error) throw new Error(error.message || "Could not remove unused complaint attachments.");
}

async function uploadComplaintAttachments(
  files: Array<{ file: File; type: "image" | "video" }>,
): Promise<Array<{ path: string; type: "image" | "video"; sort_order: number }>> {
  if (files.length === 0) return [];
  if (files.length > 6 || files.filter(file => file.type === "image").length > 5
    || files.filter(file => file.type === "video").length > 1
    || files.some(file => !["image", "video"].includes(file.type))) {
    throw new Error("Attach up to five images and one optional video.");
  }

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw new Error(userError.message || "Could not verify your account.");
  if (!userData.user) throw new Error("Sign in to attach complaint files.");

  const uploaded: Array<{ path: string; type: "image" | "video"; sort_order: number }> = [];
  try {
    for (const [sortOrder, attachment] of files.entries()) {
      const { file, type } = attachment;
      const allowedTypes = type === "image" ? IMAGE_TYPES : VIDEO_TYPES;
      const sizeLimit = type === "image" ? MAX_IMAGE_SIZE : MAX_VIDEO_SIZE;
      const kindLabel = type === "image" ? "Image" : "Video";
      if (!allowedTypes.includes(file.type) || file.size <= 0 || file.size > sizeLimit) {
        throw new Error(
          type === "image"
            ? "Images must be JPG, PNG, or WEBP and 10MB or smaller."
            : "Video must be MP4, WEBM, or MOV and 50MB or smaller.",
        );
      }

      const extension = file.type === "image/jpeg" ? "jpg"
        : file.type === "image/png" ? "png"
        : file.type === "image/webp" ? "webp"
        : file.type === "video/mp4" ? "mp4"
        : file.type === "video/webm" ? "webm"
        : "mov";
      const path = `${userData.user.id}/${crypto.randomUUID()}.${extension}`;
      const { error } = await supabase.storage
        .from(REQUEST_ATTACHMENT_BUCKET)
        .upload(path, file, { contentType: file.type, upsert: false });
      if (error) throw new Error(error.message || `Could not upload the complaint ${kindLabel.toLowerCase()}.`);
      uploaded.push({ path, type, sort_order: sortOrder });
    }
  } catch (error) {
    try {
      await removeUnattachedFiles(uploaded.map(file => file.path));
    } catch (cleanupError) {
      console.error("Could not clean up unused complaint attachments:", cleanupError);
    }
    throw error;
  }
  return uploaded;
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

async function addSignedComplaintAttachments(
  complaints: TenantComplaint[],
  action: "list_tenant_complaint_attachments" | "list_admin_complaint_attachments",
): Promise<TenantComplaint[]> {
  if (complaints.length === 0) return complaints;
  const { data, error } = await supabase.rpc(action);
  if (error) throw new Error(error.message || "Could not load complaint attachments.");
  if (!Array.isArray(data)) throw new Error("The complaint attachment service returned an invalid list.");

  const rawAttachments = data as Array<{
    attachment_id?: unknown;
    complaint_id?: unknown;
    path?: unknown;
    type?: unknown;
    sort_order?: unknown;
  }>;
  const attachments = rawAttachments.map(attachment => {
    if (
      typeof attachment.attachment_id !== "number"
      || typeof attachment.complaint_id !== "number"
      || typeof attachment.path !== "string"
      || (attachment.type !== "image" && attachment.type !== "video")
      || typeof attachment.sort_order !== "number"
    ) {
      throw new Error("The complaint attachment service returned invalid attachment data.");
    }
    return {
      attachment_id: attachment.attachment_id,
      complaint_id: attachment.complaint_id,
      path: attachment.path,
      type: attachment.type,
      sort_order: attachment.sort_order,
      signed_url: "",
    } satisfies ComplaintAttachment;
  });
  if (attachments.length === 0) return complaints;

  const signedUrlByPath = new Map<string, string>();
  const now = Date.now();
  const pathsToSign = new Set<string>();
  for (const attachment of attachments) {
    const cached = signedAttachmentUrlCache.get(attachment.path);
    if (cached && cached.expiresAt > now) signedUrlByPath.set(attachment.path, cached.url);
    else {
      signedAttachmentUrlCache.delete(attachment.path);
      pathsToSign.add(attachment.path);
    }
  }
  if (pathsToSign.size > 0) {
    const paths = [...pathsToSign];
    for (let start = 0; start < paths.length; start += 100) {
      const batch = paths.slice(start, start + 100);
      const { data: signedFiles, error: signingError } = await supabase.storage
        .from(REQUEST_ATTACHMENT_BUCKET)
        .createSignedUrls(batch, SIGNED_URL_TTL_SECONDS);
      if (signingError) throw new Error(signingError.message || "Could not open complaint attachments.");
      if (!signedFiles || signedFiles.length !== batch.length) {
        throw new Error("The complaint attachment service returned incomplete file links.");
      }
      for (const signedFile of signedFiles) {
        if (!signedFile.signedUrl || signedFile.error || !signedFile.path) {
          throw new Error(signedFile.error || "Could not open a complaint attachment.");
        }
        signedUrlByPath.set(signedFile.path, signedFile.signedUrl);
        signedAttachmentUrlCache.set(signedFile.path, {
          url: signedFile.signedUrl,
          expiresAt: now + SIGNED_URL_TTL_SECONDS * 1000 - 10000,
        });
      }
    }
  }
  const attachmentsByComplaint = new Map<number, ComplaintAttachment[]>();
  for (const attachment of attachments) {
    const signedUrl = signedUrlByPath.get(attachment.path);
    if (!signedUrl) throw new Error("Could not open a complaint attachment.");
    const complaintAttachments = attachmentsByComplaint.get(attachment.complaint_id) ?? [];
    complaintAttachments.push({ ...attachment, signed_url: signedUrl });
    attachmentsByComplaint.set(attachment.complaint_id, complaintAttachments);
  }
  return complaints.map(complaint => ({
    ...complaint,
    attachments: (attachmentsByComplaint.get(complaint.complaint_id) ?? [])
      .sort((left, right) => left.sort_order - right.sort_order),
  }));
}

export async function listTenantComplaints(): Promise<TenantComplaint[]> {
  const response = await invokeRequest<TenantComplaint[]>("tenant_list_complaints");
  if (!Array.isArray(response.data)) throw new Error("The complaint service returned an invalid list.");
  return addSignedComplaintAttachments(response.data, "list_tenant_complaint_attachments");
}

export async function createTenantComplaint(input: {
  title: string;
  description: string;
  category: string;
  is_urgent: boolean;
}, files: Array<{ file: File; type: "image" | "video" }> = []): Promise<TenantRequestResponse> {
  const uploaded = await uploadComplaintAttachments(files);
  let response: TenantRequestResponse;
  try {
    response = await invokeRequest("tenant_create_complaint", { ...input, photo_path: null });
  } catch (error) {
    try {
      await removeUnattachedFiles(uploaded.map(file => file.path));
    } catch (cleanupError) {
      console.error("Could not clean up unused complaint attachments:", cleanupError);
    }
    throw error;
  }
  if (uploaded.length === 0) return response;

  const complaintId = response.complaint_id;
  if (typeof complaintId !== "number" || !Number.isInteger(complaintId) || complaintId < 1) {
    try {
      await removeUnattachedFiles(uploaded.map(file => file.path));
    } catch (cleanupError) {
      console.error("Could not clean up unlinked complaint attachments:", cleanupError);
    }
    throw new Error("The complaint was filed, but the service did not return its ID to link attachments.");
  }

  try {
    const { data, error } = await supabase.rpc("attach_tenant_complaint_attachments", {
      p_complaint_id: complaintId,
      p_attachments: uploaded,
    });
    if (error) throw new Error(error.message || "Could not save complaint attachments.");
    if (!data || typeof data !== "object" || !("type" in data) || data.type !== "success") {
      const message = data && typeof data === "object" && "message" in data && typeof data.message === "string"
        ? data.message
        : "Could not save complaint attachments.";
      throw new Error(message);
    }
  } catch (error) {
    try {
      await removeUnattachedFiles(uploaded.map(file => file.path));
    } catch (cleanupError) {
      console.error("Could not clean up unlinked complaint attachments:", cleanupError);
    }
    throw new ComplaintAttachmentSaveError(complaintId, error);
  }
  return response;
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
  return addSignedComplaintAttachments(response.data, "list_admin_complaint_attachments");
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

export async function deleteComplaint(complaintId: number, attachmentPaths: string[] = []): Promise<string> {
  const response = await invokeRequest("admin_delete_complaint", { complaint_id: complaintId });
  if (attachmentPaths.length > 0) {
    const { error } = await supabase.storage.from(REQUEST_ATTACHMENT_BUCKET).remove(attachmentPaths);
    if (error) {
      throw new Error(`Complaint deleted, but its attachments could not be removed: ${error.message}`);
    }
  }
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
