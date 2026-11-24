import { supabase } from "@/lib/supabase";

export interface RequestStatusHistory {
  status: string;
  changed_at: string;
  changed_by_name: string | null;
}

export interface RequestMediaAttachment {
  attachment_id: number;
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
  attachments?: RequestMediaAttachment[];
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
  attachments?: RequestMediaAttachment[];
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
export const MAX_REQUEST_VIDEO_SIZE_BYTES = 100 * 1024 * 1024;
const SIGNED_URL_TTL_SECONDS = 300;
const signedAttachmentUrlCache = new Map<string, { url: string; expiresAt: number }>();

export class ComplaintAttachmentSaveError extends Error {
  constructor(public readonly complaintId: number, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : "An unexpected error occurred.";
    super(`Complaint #${complaintId} was filed, but its attachments could not be saved: ${detail}`);
    this.name = "ComplaintAttachmentSaveError";
  }
}

export class MaintenanceAttachmentSaveError extends Error {
  constructor(public readonly requestId: number, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : "An unexpected error occurred.";
    super(`Maintenance request #${requestId} was submitted, but its attachments could not be saved: ${detail}`);
    this.name = "MaintenanceAttachmentSaveError";
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

async function removeUnattachedFiles(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const { error } = await supabase.storage.from(REQUEST_ATTACHMENT_BUCKET).remove(paths);
  if (error) throw new Error(error.message || "Could not remove unused request attachments.");
}

type UploadableRequestAttachment = { file: File; type: "image" | "video" };
type UploadedRequestAttachment = { path: string; type: "image" | "video"; sort_order: number };

async function uploadRequestAttachments(
  files: UploadableRequestAttachment[],
  requestType: "complaint" | "maintenance",
): Promise<UploadedRequestAttachment[]> {
  if (files.length === 0) return [];
  if (files.length > 6 || files.filter(file => file.type === "image").length > 5
    || files.filter(file => file.type === "video").length > 1
    || files.some(file => !["image", "video"].includes(file.type))) {
    throw new Error("Attach up to five images and one optional video.");
  }

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw new Error(userError.message || "Could not verify your account.");
  if (!userData.user) throw new Error(`Sign in to attach ${requestType} files.`);

  const uploaded: UploadedRequestAttachment[] = [];
  try {
    for (const [sortOrder, attachment] of files.entries()) {
      const { file, type } = attachment;
      const allowedTypes = type === "image" ? IMAGE_TYPES : VIDEO_TYPES;
      const sizeLimit = type === "image" ? MAX_IMAGE_SIZE : MAX_REQUEST_VIDEO_SIZE_BYTES;
      const kindLabel = type === "image" ? "image" : "video";
      if (!allowedTypes.includes(file.type) || file.size <= 0 || file.size > sizeLimit) {
        throw new Error(
          type === "image"
            ? "Images must be JPG, PNG, or WEBP and 10MB or smaller."
            : "Video must be MP4, WEBM, or MOV and 100MB or smaller.",
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
      if (error) throw new Error(error.message || `Could not upload the ${requestType} ${kindLabel}.`);
      uploaded.push({ path, type, sort_order: sortOrder });
    }
  } catch (error) {
    try {
      await removeUnattachedFiles(uploaded.map(file => file.path));
    } catch (cleanupError) {
      console.error(`Could not clean up unused ${requestType} attachments:`, cleanupError);
    }
    throw error;
  }
  return uploaded;
}

async function createRequestWithAttachments(
  action: "tenant_create_complaint" | "tenant_create_maintenance",
  data: Record<string, unknown>,
  files: UploadableRequestAttachment[],
  requestType: "complaint" | "maintenance",
): Promise<TenantRequestResponse> {
  const uploaded = await uploadRequestAttachments(files, requestType);
  let response: TenantRequestResponse;
  try {
    response = await invokeRequest(action, { ...data, photo_path: null });
  } catch (error) {
    try {
      await removeUnattachedFiles(uploaded.map(file => file.path));
    } catch (cleanupError) {
      console.error(`Could not clean up unused ${requestType} attachments:`, cleanupError);
    }
    throw error;
  }
  if (uploaded.length === 0) return response;

  const requestIdKey = requestType === "complaint" ? "complaint_id" : "request_id";
  const requestId = response[requestIdKey];
  if (typeof requestId !== "number" || !Number.isInteger(requestId) || requestId < 1) {
    try {
      await removeUnattachedFiles(uploaded.map(file => file.path));
    } catch (cleanupError) {
      console.error(`Could not clean up unlinked ${requestType} attachments:`, cleanupError);
    }
    throw new Error(`The ${requestType} was submitted, but the service did not return its ID to link attachments.`);
  }

  try {
    const rpcName = requestType === "complaint"
      ? "attach_tenant_complaint_attachments"
      : "attach_tenant_maintenance_attachments";
    const rpcParams = requestType === "complaint"
      ? { p_complaint_id: requestId, p_attachments: uploaded }
      : { p_request_id: requestId, p_attachments: uploaded };
    const { data: result, error } = await supabase.rpc(rpcName, rpcParams);
    if (error) throw new Error(error.message || `Could not save ${requestType} attachments.`);
    if (!result || typeof result !== "object" || !("type" in result) || result.type !== "success") {
      const message = result && typeof result === "object" && "message" in result && typeof result.message === "string"
        ? result.message
        : `Could not save ${requestType} attachments.`;
      throw new Error(message);
    }
  } catch (error) {
    try {
      await removeUnattachedFiles(uploaded.map(file => file.path));
    } catch (cleanupError) {
      console.error(`Could not clean up unlinked ${requestType} attachments:`, cleanupError);
    }
    if (requestType === "complaint") throw new ComplaintAttachmentSaveError(requestId, error);
    throw new MaintenanceAttachmentSaveError(requestId, error);
  }
  return response;
}

async function addSignedRequestAttachments<T extends { attachments?: RequestMediaAttachment[] }>(
  requests: T[],
  action:
    | "list_tenant_complaint_attachments"
    | "list_admin_complaint_attachments"
    | "list_tenant_maintenance_attachments"
    | "list_admin_maintenance_attachments",
  requestIdKey: "complaint_id" | "request_id",
  getRequestId: (request: T) => number,
): Promise<T[]> {
  if (requests.length === 0) return requests;
  const { data, error } = await supabase.rpc(action);
  if (error) throw new Error(error.message || "Could not load request attachments.");
  if (!Array.isArray(data)) throw new Error("The request attachment service returned an invalid list.");

  const rawAttachments = data as Array<{
    attachment_id?: unknown;
    complaint_id?: unknown;
    request_id?: unknown;
    path?: unknown;
    type?: unknown;
    sort_order?: unknown;
  }>;
  const attachments = rawAttachments.map(attachment => {
    const requestId = attachment[requestIdKey];
    if (
      typeof attachment.attachment_id !== "number"
      || typeof requestId !== "number"
      || typeof attachment.path !== "string"
      || (attachment.type !== "image" && attachment.type !== "video")
      || typeof attachment.sort_order !== "number"
    ) {
      throw new Error("The request attachment service returned invalid attachment data.");
    }
    return {
      request_id: requestId,
      media: {
        attachment_id: attachment.attachment_id,
        path: attachment.path,
        type: attachment.type,
        sort_order: attachment.sort_order,
        signed_url: "",
      } satisfies RequestMediaAttachment,
    };
  });
  if (attachments.length === 0) return requests;

  const signedUrlByPath = new Map<string, string>();
  const now = Date.now();
  const pathsToSign = new Set<string>();
  for (const attachment of attachments) {
    const cached = signedAttachmentUrlCache.get(attachment.media.path);
    if (cached && cached.expiresAt > now) signedUrlByPath.set(attachment.media.path, cached.url);
    else {
      signedAttachmentUrlCache.delete(attachment.media.path);
      pathsToSign.add(attachment.media.path);
    }
  }
  if (pathsToSign.size > 0) {
    const paths = [...pathsToSign];
    for (let start = 0; start < paths.length; start += 100) {
      const batch = paths.slice(start, start + 100);
      const { data: signedFiles, error: signingError } = await supabase.storage
        .from(REQUEST_ATTACHMENT_BUCKET)
        .createSignedUrls(batch, SIGNED_URL_TTL_SECONDS);
      if (signingError) throw new Error(signingError.message || "Could not open request attachments.");
      if (!signedFiles || signedFiles.length !== batch.length) {
        throw new Error("The request attachment service returned incomplete file links.");
      }
      for (const signedFile of signedFiles) {
        if (!signedFile.signedUrl || signedFile.error || !signedFile.path) {
          throw new Error(signedFile.error || "Could not open a request attachment.");
        }
        signedUrlByPath.set(signedFile.path, signedFile.signedUrl);
        signedAttachmentUrlCache.set(signedFile.path, {
          url: signedFile.signedUrl,
          expiresAt: now + SIGNED_URL_TTL_SECONDS * 1000 - 10000,
        });
      }
    }
  }
  const attachmentsByRequest = new Map<number, RequestMediaAttachment[]>();
  for (const attachment of attachments) {
    const signedUrl = signedUrlByPath.get(attachment.media.path);
    if (!signedUrl) throw new Error("Could not open a request attachment.");
    const requestAttachments = attachmentsByRequest.get(attachment.request_id) ?? [];
    requestAttachments.push({ ...attachment.media, signed_url: signedUrl });
    attachmentsByRequest.set(attachment.request_id, requestAttachments);
  }
  return requests.map(request => ({
    ...request,
    attachments: (attachmentsByRequest.get(getRequestId(request)) ?? [])
      .sort((left, right) => left.sort_order - right.sort_order),
  }));
}

export async function listTenantComplaints(): Promise<TenantComplaint[]> {
  const response = await invokeRequest<TenantComplaint[]>("tenant_list_complaints");
  if (!Array.isArray(response.data)) throw new Error("The complaint service returned an invalid list.");
  return addSignedRequestAttachments(
    response.data,
    "list_tenant_complaint_attachments",
    "complaint_id",
    complaint => complaint.complaint_id,
  );
}

export async function createTenantComplaint(input: {
  title: string;
  description: string;
  category: string;
  is_urgent: boolean;
}, files: UploadableRequestAttachment[] = []): Promise<TenantRequestResponse> {
  return createRequestWithAttachments("tenant_create_complaint", input, files, "complaint");
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
  return addSignedRequestAttachments(
    response.data,
    "list_admin_complaint_attachments",
    "complaint_id",
    complaint => complaint.complaint_id,
  );
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
  return addSignedRequestAttachments(
    response.data,
    "list_tenant_maintenance_attachments",
    "request_id",
    request => request.request_id,
  );
}

export async function createTenantMaintenanceRequest(input: {
  title: string;
  category: string;
  description: string;
  priority: string;
}, files: UploadableRequestAttachment[] = []): Promise<void> {
  await createRequestWithAttachments("tenant_create_maintenance", input, files, "maintenance");
}

export async function cancelTenantMaintenanceRequest(requestId: number): Promise<void> {
  await invokeRequest("tenant_cancel_maintenance", { request_id: requestId });
}

export async function listAdminMaintenanceRequests(): Promise<TenantMaintenanceRequest[]> {
  const response = await invokeRequest<TenantMaintenanceRequest[]>("admin_list_maintenance");
  if (!Array.isArray(response.data)) throw new Error("The maintenance service returned an invalid list.");
  return addSignedRequestAttachments(
    response.data,
    "list_admin_maintenance_attachments",
    "request_id",
    request => request.request_id,
  );
}

export async function updateMaintenanceStatus(requestId: number, status: string): Promise<void> {
  await invokeRequest("admin_update_maintenance_status", { request_id: requestId, status });
}

export async function deleteMaintenanceRequest(requestId: number, attachmentPaths: string[] = []): Promise<string> {
  const response = await invokeRequest("admin_delete_maintenance", { request_id: requestId });
  if (attachmentPaths.length > 0) {
    const { error } = await supabase.storage.from(REQUEST_ATTACHMENT_BUCKET).remove(attachmentPaths);
    if (error) {
      throw new Error(`Maintenance request deleted, but its attachments could not be removed: ${error.message}`);
    }
  }
  return response.message || "Deleted.";
}
