import { supabase } from "@/lib/supabase";

export interface AdminNotification {
  notification_id: number;
  user_id: number;
  username: string | null;
  title: string;
  message: string;
  type: string;
  is_read: number;
  created_at: string;
}

export interface NotificationRecipient {
  user_id: number;
  username: string | null;
  full_name: string | null;
  user_type: string | null;
  email: string | null;
  label: string;
}

interface AdminNotificationResponse<T = unknown> {
  type: "success" | "error";
  message?: string;
  data?: T;
}

async function invokeAdminNotifications<T>(
  body: Record<string, string | number>,
): Promise<AdminNotificationResponse<T>> {
  const { data, error } = await supabase.functions.invoke<AdminNotificationResponse<T>>(
    "admin-notifications",
    { body },
  );
  if (error) throw error;
  if (!data || data.type !== "success") {
    throw new Error(data?.message || "Could not complete the notification action.");
  }
  return data;
}

export async function listAdminNotifications(): Promise<AdminNotification[]> {
  const response = await invokeAdminNotifications<AdminNotification[]>({ action: "list" });
  if (!Array.isArray(response.data)) throw new Error("The notification service returned an invalid list.");
  return response.data;
}

export async function listNotificationRecipients(): Promise<NotificationRecipient[]> {
  const response = await invokeAdminNotifications<NotificationRecipient[]>({ action: "users" });
  if (!Array.isArray(response.data)) throw new Error("The notification service returned an invalid recipient list.");
  return response.data;
}

export async function sendAdminNotification(input:
  | { user_id: number; title: string; message: string; type: string }
  | { user_type: string; title: string; message: string; type: string },
): Promise<string> {
  const action = "user_id" in input ? "send" : "broadcast";
  const response = await invokeAdminNotifications({ action, ...input });
  return response.message || "Sent";
}
