import { supabase } from "@/lib/supabase";

export interface AdminGuest {
  user_id: number;
  full_name: string;
  username: string;
  email: string;
  phone: string | null;
  address: string | null;
  age: number | null;
  birthday: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  is_active: number;
  created_at: string;
  profile_picture: string | null;
}

interface GuestResponse<T = unknown> {
  type: "success" | "error";
  message?: string;
  data?: T;
  user_id?: number;
}

type GuestAction = "list" | "create" | "update" | "activate" | "deactivate" | "delete";

async function invokeGuestAction<T = unknown>(
  action: GuestAction,
  data: Record<string, unknown> = {},
): Promise<GuestResponse<T>> {
  const { data: response, error } = await supabase.functions.invoke<GuestResponse<T>>(
    "admin-guests",
    { body: { action, data } },
  );
  if (error) {
    if (error.context instanceof Response) {
      try {
        const details = await error.context.clone().json() as GuestResponse;
        throw new Error(details.message || error.message);
      } catch (cause) {
        if (cause instanceof Error && cause.message !== error.message) throw cause;
      }
    }
    throw new Error(error.message || "Could not complete the guest account action.");
  }
  if (!response || response.type !== "success") {
    throw new Error(response?.message || "Could not complete the guest account action.");
  }
  return response;
}

export async function listAdminGuests(): Promise<AdminGuest[]> {
  const response = await invokeGuestAction<AdminGuest[]>("list");
  if (!Array.isArray(response.data)) throw new Error("The guest service returned an invalid list.");
  return response.data;
}

export async function createAdminGuest(guest: Record<string, unknown>): Promise<number> {
  const response = await invokeGuestAction("create", guest);
  if (typeof response.user_id !== "number") throw new Error("The guest service did not return the new account ID.");
  return response.user_id;
}

export async function updateAdminGuest(guest: Record<string, unknown>): Promise<void> {
  await invokeGuestAction("update", guest);
}

export async function setAdminGuestActive(userId: number, active: boolean): Promise<void> {
  await invokeGuestAction(active ? "activate" : "deactivate", { user_id: userId });
}

export async function deleteAdminGuest(userId: number): Promise<void> {
  await invokeGuestAction("delete", { user_id: userId });
}

export async function uploadAdminGuestPicture(userId: number, file: File): Promise<void> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024) {
    throw new Error("Profile picture must be JPG, PNG, or WEBP and 10MB or smaller.");
  }
  const formData = new FormData();
  formData.append("user_id", String(userId));
  formData.append("profile_picture", file);
  const { data, error } = await supabase.functions.invoke<GuestResponse>("admin-guests", { body: formData });
  if (error) {
    if (error.context instanceof Response) {
      try {
        const details = await error.context.clone().json() as GuestResponse;
        throw new Error(details.message || error.message);
      } catch (cause) {
        if (cause instanceof Error && cause.message !== error.message) throw cause;
      }
    }
    throw new Error(error.message || "Could not upload the guest profile picture.");
  }
  if (!data || data.type !== "success") {
    throw new Error(data?.message || "Could not upload the guest profile picture.");
  }
}
