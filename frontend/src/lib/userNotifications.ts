import { supabase } from "@/lib/supabase";

export interface UserNotification {
  notification_id: number;
  title: string;
  message: string | null;
  type: string | null;
  is_read: number;
  created_at: string;
}

interface NotificationResponse {
  type: "success" | "error";
  message?: string;
  data?: UserNotification[] | { count: number };
}

async function invokeUserNotifications(body: {
  action: string;
  notification_id?: number;
}): Promise<NotificationResponse> {
  const { data, error } = await supabase.functions.invoke<NotificationResponse>(
    "user-notifications",
    { body },
  );
  if (error) throw error;
  if (!data || data.type !== "success") {
    throw new Error(data?.message || "Could not complete the notification request.");
  }
  return data;
}

export async function listUserNotifications(): Promise<UserNotification[]> {
  const response = await invokeUserNotifications({ action: "list" });
  if (!Array.isArray(response.data)) throw new Error("The notification service returned an invalid list.");
  return response.data;
}

export async function getUserUnreadNotificationCount(): Promise<number> {
  const response = await invokeUserNotifications({ action: "unread_count" });
  if (!response.data || Array.isArray(response.data) || !("count" in response.data)) {
    throw new Error("The notification service returned an invalid unread count.");
  }
  return response.data.count;
}

export async function markUserNotificationRead(notificationId: number): Promise<void> {
  await invokeUserNotifications({ action: "mark_read", notification_id: notificationId });
}

export async function markAllUserNotificationsRead(): Promise<void> {
  await invokeUserNotifications({ action: "mark_all_read" });
}

export async function deleteUserNotification(notificationId: number): Promise<void> {
  await invokeUserNotifications({ action: "delete", notification_id: notificationId });
}
