import { supabase } from "@/lib/supabase";

export type AdminManagementEntity = "guest" | "tenant";
export type AdminManagementOperation = "read" | "create" | "update" | "delete";

export interface AdminLog {
  log_id: number;
  actor_id: number | null;
  actor_username: string | null;
  category: string;
  action: string;
  level: "info" | "warning" | "error" | "security";
  message: string | null;
  ip_address: string | null;
  user_agent: string | null;
  request_path: string | null;
  created_at: string;
}

interface AdminLogsResponse<T = unknown> {
  type: "success" | "error";
  message?: string;
  data?: T;
}

async function invokeAdminLogs<T = unknown>(
  action: "list" | "delete",
  data: Record<string, unknown> = {},
): Promise<AdminLogsResponse<T>> {
  const { data: response, error } = await supabase.functions.invoke<AdminLogsResponse<T>>(
    "admin-logs",
    { body: { action, data } },
  );
  if (error) throw error;
  if (!response || response.type !== "success") {
    throw new Error(response?.message || "Could not complete the log history action.");
  }
  return response;
}

export async function listAdminLogs(input: {
  limit?: number;
  category?: string;
  level?: string;
  query?: string;
} = {}): Promise<AdminLog[]> {
  const response = await invokeAdminLogs<AdminLog[]>("list", {
    limit: input.limit ?? 300,
    category: input.category ?? "",
    level: input.level ?? "",
    query: input.query?.trim() ?? "",
  });
  if (!Array.isArray(response.data)) throw new Error("The log history service returned an invalid list.");
  return response.data;
}

export async function deleteAdminLog(logId: number): Promise<string> {
  const response = await invokeAdminLogs("delete", { log_id: logId });
  return response.message || "Log deleted.";
}

export async function recordAdminManagementLog(input: {
  entity: AdminManagementEntity;
  operation: AdminManagementOperation;
  resourceId: number | null;
  message: string;
}): Promise<void> {
  if (input.resourceId !== null && (!Number.isSafeInteger(input.resourceId) || input.resourceId <= 0)) {
    throw new Error("The management audit event has an invalid resource ID.");
  }
  const { data, error } = await supabase.rpc("record_admin_management_log", {
    p_entity: input.entity,
    p_operation: input.operation,
    p_resource_id: input.resourceId,
    p_message: input.message,
  });
  if (error) throw new Error(error.message || "Could not record the management audit event.");
  if (!data || typeof data !== "object" || !("type" in data) || data.type !== "success") {
    throw new Error("The audit service returned an invalid response.");
  }
}

export async function tryRecordAdminManagementLog(input: {
  entity: AdminManagementEntity;
  operation: AdminManagementOperation;
  resourceId: number | null;
  message: string;
}): Promise<string | null> {
  try {
    await recordAdminManagementLog(input);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "Could not record the management audit event.";
  }
}
