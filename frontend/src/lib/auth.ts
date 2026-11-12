import { supabase } from "@/lib/supabase";
import { sessionStore } from "@/lib/api";

export type AuthProfile = {
  user_id: number;
  username: string;
  full_name: string;
  email: string;
  phone: string;
  user_type: string;
};

type AuthResponse = {
  type: "success" | "error";
  message?: string;
};

function parseProfile(value: unknown): AuthProfile {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object") {
    throw new Error("Your account profile could not be loaded.");
  }
  const fields = row as Record<string, unknown>;
  if (
    typeof fields.user_id !== "number"
    || typeof fields.username !== "string"
    || typeof fields.full_name !== "string"
    || typeof fields.email !== "string"
    || typeof fields.phone !== "string"
    || typeof fields.user_type !== "string"
  ) {
    throw new Error("Your account profile is incomplete.");
  }
  return {
    user_id: fields.user_id,
    username: fields.username,
    full_name: fields.full_name,
    email: fields.email,
    phone: fields.phone,
    user_type: fields.user_type,
  };
}

export async function authAction<T extends AuthResponse>(
  action: string,
  payload: Record<string, unknown> = {},
): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>("auth", {
    body: { action, ...payload },
  });
  if (error) {
    if ("context" in error && error.context instanceof Response) {
      try {
        const responseBody = await error.context.clone().json() as { message?: unknown };
        if (typeof responseBody.message === "string") throw new Error(responseBody.message);
      } catch (contextError) {
        if (contextError instanceof Error && contextError.message !== "Unexpected end of JSON input") {
          throw contextError;
        }
      }
    }
    throw new Error(error.message || "Authentication request failed.");
  }
  if (!data) throw new Error("Authentication service returned no response.");
  if (data.type === "error") throw new Error(data.message || "Authentication request failed.");
  return data;
}

export async function loadMyProfile(): Promise<AuthProfile> {
  const { data, error } = await supabase.rpc("get_my_profile");
  if (error) throw new Error(error.message || "Could not load your account profile.");
  return parseProfile(data);
}

export async function refreshSupabaseProfile(): Promise<AuthProfile | null> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error(error.message || "Could not check the current sign-in session.");
  if (!data.session) {
    sessionStore.clear();
    return null;
  }
  const profile = await loadMyProfile();
  sessionStore.set(profile);
  return profile;
}

export async function signInWithIdentifier(identifier: string, password: string): Promise<AuthProfile> {
  const response = await authAction<{
    type: "success";
    session: { access_token: string; refresh_token: string };
  }>("signin", { username: identifier.trim(), password });

  const { error } = await supabase.auth.setSession(response.session);
  if (error) throw new Error(error.message || "Could not establish the sign-in session.");

  try {
    const profile = await loadMyProfile();
    sessionStore.set(profile);
    return profile;
  } catch (error) {
    await supabase.auth.signOut();
    sessionStore.clear();
    throw error;
  }
}

export async function signUpGuest(
  input: {
    full_name: string;
    username: string;
    email: string;
    phone: string;
    address: string;
    birthday: string;
    age: number;
    emergency_contact_name: string;
    emergency_contact_phone: string;
    password: string;
    otp: string;
  },
  profilePicture: File | null,
): Promise<{ profile: AuthProfile; profilePictureError?: string }> {
  if (profilePicture && (
    profilePicture.size > 5 * 1024 * 1024
    || !["image/jpeg", "image/png", "image/webp"].includes(profilePicture.type)
  )) {
    throw new Error("Profile pictures must be JPEG, PNG, or WebP and no larger than 5 MB.");
  }

  const response = await authAction<{
    type: "success";
    session: { access_token: string; refresh_token: string };
  }>("signup", input);
  const { data, error } = await supabase.auth.setSession(response.session);
  if (error) throw new Error(error.message || "Account was created, but sign-in could not be completed.");

  const profile = await loadMyProfile();
  sessionStore.set(profile);
  if (!profilePicture || !data.user) return { profile };

  const extension = profilePicture.type === "image/png" ? "png"
    : profilePicture.type === "image/webp" ? "webp"
    : "jpg";
  const path = `${data.user.id}/${crypto.randomUUID()}.${extension}`;
  const { error: uploadError } = await supabase.storage
    .from("mbh-profile-pictures")
    .upload(path, profilePicture, { contentType: profilePicture.type, upsert: false });
  if (uploadError) {
    return { profile, profilePictureError: uploadError.message };
  }

  const { error: profileError } = await supabase.rpc("set_my_profile_picture", { p_path: path });
  if (profileError) {
    const { error: removeError } = await supabase.storage.from("mbh-profile-pictures").remove([path]);
    if (removeError) console.error("Could not remove an unlinked profile picture", removeError);
    return { profile, profilePictureError: profileError.message };
  }
  return { profile };
}

export async function signOutSupabase(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) throw new Error(error.message || "Could not sign out.");
  sessionStore.clear();
  localStorage.removeItem("guestUser");
}
