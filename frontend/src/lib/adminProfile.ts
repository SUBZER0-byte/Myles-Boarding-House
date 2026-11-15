import { supabase } from "@/lib/supabase";

export interface AdminSettingsProfile {
  user_id: number;
  full_name: string;
  username: string;
  email: string;
  phone: string | null;
  profile_picture: string | null;
}

function parseAdminProfile(value: unknown): AdminSettingsProfile {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object") throw new Error("Administrator profile could not be loaded.");
  const profile = row as Record<string, unknown>;
  if (
    typeof profile.user_id !== "number"
    || typeof profile.full_name !== "string"
    || typeof profile.username !== "string"
    || typeof profile.email !== "string"
  ) {
    throw new Error("Administrator profile is incomplete.");
  }
  return {
    user_id: profile.user_id,
    full_name: profile.full_name,
    username: profile.username,
    email: profile.email,
    phone: typeof profile.phone === "string" ? profile.phone : null,
    profile_picture: typeof profile.profile_picture === "string" ? profile.profile_picture : null,
  };
}

export async function getMyAdminSettingsProfile(): Promise<AdminSettingsProfile> {
  const { data, error } = await supabase.rpc("get_my_admin_settings_profile");
  if (error) throw new Error(error.message || "Could not load administrator profile.");
  return parseAdminProfile(data);
}

export async function saveMyAdminSettingsProfile(profile: AdminSettingsProfile): Promise<void> {
  if (!profile.full_name.trim() || profile.full_name.trim().length > 150) {
    throw new Error("Enter a valid name.");
  }
  const { error } = await supabase.rpc("update_my_admin_settings_profile", {
    p_full_name: profile.full_name,
    p_phone: profile.phone ?? "",
  });
  if (error) throw new Error(error.message || "Could not save administrator profile.");
}

export async function requestAdminEmailChange(nextEmail: string): Promise<boolean> {
  const email = nextEmail.trim().toLowerCase();
  if (email.length > 150 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Enter a valid email address.");
  }
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw new Error(userError.message || "Could not verify administrator account.");
  if (!userData.user?.email) throw new Error("Administrator account has no sign-in email.");
  if (userData.user.email.toLowerCase() === email) return false;

  const { data: available, error: availabilityError } = await supabase.rpc("is_my_admin_email_available", {
    p_email: email,
  });
  if (availabilityError) throw new Error(availabilityError.message || "Could not check email availability.");
  if (available !== true) throw new Error("That email address is already in use.");

  const { error } = await supabase.auth.updateUser({ email });
  if (error) throw new Error(error.message || "Could not request the email change.");
  return true;
}
