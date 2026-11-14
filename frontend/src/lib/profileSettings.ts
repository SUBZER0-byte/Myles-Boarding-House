import { supabase } from "@/lib/supabase";
import { isSupabaseStorageImagePath } from "@/lib/storagePaths";

export interface SettingsProfile {
  user_id: number;
  full_name: string;
  username: string;
  email: string;
  phone: string | null;
  address: string | null;
  age: number | string | null;
  birthday: string | null;
  user_type: string;
  tenant_id?: number | null;
  move_in_date?: string | null;
  room_number?: string | null;
  profile_picture?: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
}

function getProfileRow(value: unknown): SettingsProfile {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object") {
    throw new Error("Your account profile could not be loaded.");
  }
  const fields = row as Record<string, unknown>;
  if (
    typeof fields.user_id !== "number"
    || typeof fields.full_name !== "string"
    || typeof fields.username !== "string"
    || typeof fields.email !== "string"
    || typeof fields.user_type !== "string"
  ) {
    throw new Error("Your account profile is incomplete.");
  }
  return {
    user_id: fields.user_id,
    full_name: fields.full_name,
    username: fields.username,
    email: fields.email,
    phone: typeof fields.phone === "string" ? fields.phone : null,
    address: typeof fields.address === "string" ? fields.address : null,
    age: typeof fields.age === "number" || typeof fields.age === "string" ? fields.age : null,
    birthday: typeof fields.birthday === "string" ? fields.birthday : null,
    user_type: fields.user_type,
    tenant_id: typeof fields.tenant_id === "number" ? fields.tenant_id : null,
    move_in_date: typeof fields.move_in_date === "string" ? fields.move_in_date : null,
    room_number: typeof fields.room_number === "string" ? fields.room_number : null,
    profile_picture: typeof fields.profile_picture === "string" ? fields.profile_picture : null,
    emergency_contact_name: typeof fields.emergency_contact_name === "string" ? fields.emergency_contact_name : null,
    emergency_contact_phone: typeof fields.emergency_contact_phone === "string" ? fields.emergency_contact_phone : null,
  };
}

export async function getMySettingsProfile(): Promise<SettingsProfile> {
  const { data, error } = await supabase.rpc("get_my_settings_profile");
  if (error) throw new Error(error.message || "Could not load your profile.");
  return getProfileRow(data);
}

export async function saveMySettingsProfile(profile: SettingsProfile): Promise<void> {
  const email = profile.email.trim();
  if (email.length > 150 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Enter a valid email address.");
  }
  const age = profile.age === "" || profile.age === null ? null : Number(profile.age);
  if (age !== null && (!Number.isInteger(age) || age < 0 || age > 120)) {
    throw new Error("Age must be a number from 0 to 120.");
  }

  const { error } = await supabase.rpc("update_my_settings_profile", {
    p_full_name: profile.full_name,
    p_phone: profile.phone ?? "",
    p_address: profile.address ?? "",
    p_age: age,
    p_birthday: profile.birthday || null,
    p_emergency_contact_name: profile.emergency_contact_name ?? "",
    p_emergency_contact_phone: profile.emergency_contact_phone ?? "",
  });
  if (error) throw new Error(error.message || "Could not save your profile.");
}

export async function requestMyEmailChange(nextEmail: string): Promise<boolean> {
  const email = nextEmail.trim().toLowerCase();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw new Error(userError.message || "Could not verify your account.");
  if (!userData.user?.email) throw new Error("Your account does not have a sign-in email.");
  if (userData.user.email.toLowerCase() === email) return false;

  const { data: available, error: availabilityError } = await supabase.rpc("is_my_profile_email_available", {
    p_email: email,
  });
  if (availabilityError) throw new Error(availabilityError.message || "Could not check email availability.");
  if (available !== true) throw new Error("That email address is already in use.");

  const { error } = await supabase.auth.updateUser({ email });
  if (error) throw new Error(error.message || "Could not request the email change.");
  return true;
}

export async function changeMyPassword(currentPassword: string, newPassword: string): Promise<void> {
  if (newPassword.length < 6 || newPassword.length > 200) {
    throw new Error("Password must be 6–200 characters long.");
  }

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw new Error(userError.message || "Could not verify your account.");
  const email = userData.user?.email;
  if (!email) throw new Error("Your account does not have a password sign-in email.");

  const { error: signInError } = await supabase.auth.signInWithPassword({
    email,
    password: currentPassword,
  });
  if (signInError) {
    if (signInError.code === "invalid_credentials" || signInError.message === "Invalid login credentials") {
      throw new Error("Current password is incorrect.");
    }
    throw new Error(signInError.message || "Could not verify your current password.");
  }

  const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
  if (updateError) throw new Error(updateError.message || "Could not update your password.");
}

export function getProfilePictureUrl(path: string | null | undefined): string {
  if (isSupabaseStorageImagePath(path)) {
    return supabase.storage.from("mbh-profile-pictures").getPublicUrl(path).data.publicUrl;
  }
  return "";
}

export async function uploadMyProfilePicture(file: File, currentPath?: string | null): Promise<void> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024) {
    throw new Error("Profile picture must be JPG, PNG, or WEBP and 5MB or smaller.");
  }

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw new Error(userError.message || "Could not verify your account.");
  if (!userData.user) throw new Error("Sign in to upload a profile picture.");

  const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${userData.user.id}/${crypto.randomUUID()}.${extension}`;
  const { error: uploadError } = await supabase.storage
    .from("mbh-profile-pictures")
    .upload(path, file, { contentType: file.type, upsert: false });
  if (uploadError) throw new Error(uploadError.message || "Could not upload your profile picture.");

  const { error: profileError } = await supabase.rpc("set_my_profile_picture", { p_path: path });
  if (profileError) {
    const { error: removeError } = await supabase.storage.from("mbh-profile-pictures").remove([path]);
    if (removeError) console.error("Could not remove an unlinked profile picture", removeError);
    throw new Error(profileError.message || "Could not save your profile picture.");
  }

  if (currentPath && currentPath.startsWith(`${userData.user.id}/`)) {
    const { error: removeError } = await supabase.storage.from("mbh-profile-pictures").remove([currentPath]);
    if (removeError) console.error("Could not remove the previous profile picture", removeError);
  }
}
