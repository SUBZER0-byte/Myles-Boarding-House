import { supabase } from "@/lib/supabase";

export interface AdminAnnouncement {
  announcement_id: number;
  title: string;
  body: string;
  is_published: number;
  created_at: string;
}

interface AnnouncementResponse {
  type: "success" | "error";
  message?: string;
  announcement_id?: number;
  data?: AdminAnnouncement[];
}

async function runAnnouncementAction(
  action: string,
  values: Record<string, string | number> = {},
): Promise<AnnouncementResponse> {
  const { data, error } = await supabase.functions.invoke<AnnouncementResponse>(
    "admin-announcements",
    { body: { action, ...values } },
  );
  if (error) throw error;
  if (!data || data.type !== "success") {
    throw new Error(data?.message || "Could not complete the announcement action.");
  }
  return data;
}

export async function listAdminAnnouncements(): Promise<AdminAnnouncement[]> {
  const result = await runAnnouncementAction("list");
  if (!Array.isArray(result.data)) throw new Error("The announcement service returned an invalid list.");
  return result.data;
}

export async function saveAdminAnnouncement(
  announcement: { title: string; body: string; is_published: number },
  announcementId?: number,
): Promise<void> {
  await runAnnouncementAction(announcementId ? "update" : "create", {
    ...announcement,
    ...(announcementId ? { announcement_id: announcementId } : {}),
  });
}

export async function setAdminAnnouncementPublished(
  announcementId: number,
  isPublished: number,
): Promise<void> {
  await runAnnouncementAction("publish", {
    announcement_id: announcementId,
    is_published: isPublished,
  });
}

export async function deleteAdminAnnouncement(announcementId: number): Promise<void> {
  await runAnnouncementAction("delete", { announcement_id: announcementId });
}
