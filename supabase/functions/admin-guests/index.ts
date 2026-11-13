import { createSupabaseAdminClient } from "../_shared/supabase.ts";

const allowedOrigins = new Set(
  (Deno.env.get("APP_ALLOWED_ORIGINS") ?? "https://myles-boarding-house.vercel.app")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);

const admin = createSupabaseAdminClient();

type GuestInput = {
  user_id?: unknown;
  full_name?: unknown;
  username?: unknown;
  email?: unknown;
  phone?: unknown;
  address?: unknown;
  birthday?: unknown;
  emergency_contact_name?: unknown;
  emergency_contact_phone?: unknown;
  password?: unknown;
  new_password?: unknown;
};

class GuestInputError extends Error {}

function jsonResponse(body: unknown, status: number, origin: string | null): Response {
  const headers = new Headers({
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Vary": "Origin",
  });
  if (origin && allowedOrigins.has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Headers", "authorization, apikey, content-type, x-client-info");
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function passwordText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function canonicalPhone(value: unknown): string | null {
  const digits = text(value).replace(/\D/g, "");
  if (!digits) return null;
  if (/^09\d{9}$/.test(digits)) return `+63${digits.slice(1)}`;
  if (/^639\d{9}$/.test(digits)) return `+${digits}`;
  if (/^9\d{9}$/.test(digits)) return `+63${digits}`;
  return null;
}

function calculateAge(birthday: string): number | null {
  if (!birthday) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthday)) throw new GuestInputError("Enter a valid birthday that is not in the future.");
  const date = new Date(`${birthday}T00:00:00`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== birthday) {
    throw new GuestInputError("Enter a valid birthday that is not in the future.");
  }
  const today = new Date();
  if (date > new Date(today.getFullYear(), today.getMonth(), today.getDate())) {
    throw new GuestInputError("Enter a valid birthday that is not in the future.");
  }
  let age = today.getFullYear() - date.getFullYear();
  if (
    today.getMonth() < date.getMonth()
    || (today.getMonth() === date.getMonth() && today.getDate() < date.getDate())
  ) age -= 1;
  if (age > 120) throw new GuestInputError("Enter a valid birthday.");
  return age;
}

function validateGuest(input: GuestInput, creating: boolean) {
  const fullName = text(input.full_name);
  const username = text(input.username);
  const email = text(input.email).toLowerCase();
  const phoneText = text(input.phone);
  const phone = canonicalPhone(phoneText);
  const address = text(input.address);
  const birthday = text(input.birthday);
  const emergencyName = text(input.emergency_contact_name);
  const emergencyPhoneText = text(input.emergency_contact_phone);
  const emergencyPhone = canonicalPhone(emergencyPhoneText);
  const password = passwordText(creating ? input.password : input.new_password);

  if (!/^[\p{L} .'-]{2,150}$/u.test(fullName)) {
    throw new GuestInputError("Enter a valid full name (2–150 characters).");
  }
  if (creating && !/^[A-Za-z0-9._-]{3,50}$/.test(username)) {
    throw new GuestInputError("Username must be 3–50 characters and use only letters, numbers, dots, underscores, or hyphens.");
  }
  if (email.length > 150 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new GuestInputError("Enter a valid email address (maximum 150 characters).");
  }
  if (creating && (password.length < 6 || password.length > 200)) {
    throw new GuestInputError("Password must be 6–200 characters long.");
  }
  if (!creating && password && (password.length < 6 || password.length > 200)) {
    throw new GuestInputError("New password must be 6–200 characters long.");
  }
  if (phoneText && !phone) throw new GuestInputError("Enter a valid Philippine mobile number.");
  if (address.length > 255 || emergencyName.length > 150) {
    throw new GuestInputError("Address or emergency contact name is too long.");
  }
  if (emergencyPhoneText && !emergencyPhone) throw new GuestInputError("Enter a valid emergency contact mobile number.");
  const age = calculateAge(birthday);

  return {
    full_name: fullName,
    username,
    email,
    phone,
    address: address || null,
    birthday: birthday || null,
    age,
    emergency_contact_name: emergencyName || null,
    emergency_contact_phone: emergencyPhone,
    password,
  };
}

async function checkAdmin(request: Request) {
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return { error: "Authentication required.", status: 401 } as const;
  const { data: authData, error: authError } = await admin.auth.getUser(authorization.slice(7));
  if (authError || !authData.user) return { error: "Authentication required.", status: 401 } as const;
  const { data: profile, error } = await admin
    .from("users")
    .select("user_id,user_type,is_active")
    .eq("auth_user_id", authData.user.id)
    .maybeSingle();
  if (error) {
    console.error("Could not verify the Admin guests caller:", error);
    return { error: "Could not verify the account.", status: 500 } as const;
  }
  if (!profile || profile.user_type !== "Admin" || profile.is_active !== 1) {
    return { error: "Administrator access is required.", status: 403 } as const;
  }
  return { user: authData.user } as const;
}

function parseId(value: unknown): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new GuestInputError("Invalid guest account.");
  return id;
}

async function handleAction(action: string, input: GuestInput, request: Request): Promise<{ body: unknown; status: number }> {
  if (action === "list") {
    const { data, error } = await admin
      .from("users")
      .select("user_id,full_name,username,email,phone,address,age,birthday,emergency_contact_name,emergency_contact_phone,is_active,created_at,profile_picture")
      .eq("user_type", "Guest")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return { body: { type: "success", data }, status: 200 };
  }

  if (action === "create") {
    const guest = validateGuest(input, true);
    const checks: Array<[string, string, string]> = [
      ["username", guest.username, "Username is already used by another account."],
      ["email", guest.email, "Email is already used by another account."],
    ];
    if (guest.phone) checks.push(["phone", guest.phone, "Phone number is already used by another account."]);
    for (const [field, value, message] of checks) {
      const { data, error } = await admin.from("users").select("user_id").eq(field, value).limit(1);
      if (error) throw error;
      if (data?.length) return { body: { type: "error", message }, status: 409 };
    }

    const nonce = crypto.randomUUID();
    const { error: nonceError } = await admin.from("auth_admin_guest_create_nonces").insert({
      nonce,
      email: guest.email,
      username: guest.username,
      full_name: guest.full_name,
      phone: guest.phone,
      address: guest.address,
      birthday: guest.birthday,
      age: guest.age,
      emergency_contact_name: guest.emergency_contact_name,
      emergency_contact_phone: guest.emergency_contact_phone,
      expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    });
    if (nonceError) throw nonceError;

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: guest.email,
      password: guest.password,
      email_confirm: true,
      user_metadata: {
        mbh_admin_guest_create_nonce: nonce,
        full_name: guest.full_name,
        username: guest.username,
        phone: guest.phone,
        address: guest.address,
        birthday: guest.birthday,
        age: guest.age,
        emergency_contact_name: guest.emergency_contact_name,
        emergency_contact_phone: guest.emergency_contact_phone,
      },
    });
    if (createError || !created.user) {
      const { error: cleanupError } = await admin
        .from("auth_admin_guest_create_nonces")
        .delete()
        .eq("nonce", nonce);
      if (cleanupError) console.error("Could not remove the unused guest creation claim:", cleanupError);
      console.error("Could not create the guest Auth account:", createError);
      return { body: { type: "error", message: "Could not create the guest account. Check whether the email is already in use." }, status: 409 };
    }

    const { data: profile, error: profileError } = await admin
      .from("users")
      .select("user_id")
      .eq("auth_user_id", created.user.id)
      .eq("user_type", "Guest")
      .maybeSingle();
    if (profileError || !profile) {
      console.error("Guest Auth account was created but the profile link could not be verified.", profileError);
      const { error: cleanupError } = await admin.auth.admin.deleteUser(created.user.id);
      if (cleanupError) console.error("Could not remove the unlinked guest Auth account:", cleanupError);
      return { body: { type: "error", message: "Guest Auth was created, but the profile could not be verified." }, status: 500 };
    }
    return { body: { type: "success", message: "Guest account created.", user_id: profile.user_id }, status: 200 };
  }

  if (action === "update") {
    const id = parseId(input.user_id);
    const guest = validateGuest(input, false);
    const { data: existing, error: existingError } = await admin
      .from("users")
      .select("user_id,email,phone,auth_user_id")
      .eq("user_id", id)
      .eq("user_type", "Guest")
      .maybeSingle();
    if (existingError) throw existingError;
    if (!existing) return { body: { type: "error", message: "Guest account not found." }, status: 404 };

    const checks: Array<[string, string, string]> = [["email", guest.email, "Email is already used by another account."]];
    if (guest.phone) checks.push(["phone", guest.phone, "Phone number is already used by another account."]);
    for (const [field, value, message] of checks) {
      const { data, error } = await admin.from("users").select("user_id").eq(field, value).neq("user_id", id).limit(1);
      if (error) throw error;
      if (data?.length) return { body: { type: "error", message }, status: 409 };
    }
    if ((guest.email !== existing.email || guest.password) && !existing.auth_user_id) {
      return { body: { type: "error", message: "This guest has no linked Supabase Auth account; email and password cannot be changed." }, status: 409 };
    }

    const { data: authRecord, error: authReadError } = existing.auth_user_id
      ? await admin.auth.admin.getUserById(existing.auth_user_id)
      : { data: null, error: null };
    if (authReadError) throw authReadError;
    const oldAuthEmail = authRecord?.user.email ?? "";
    let authEmailChanged = false;
    if (existing.auth_user_id && guest.email !== oldAuthEmail) {
      const { error } = await admin.auth.admin.updateUserById(existing.auth_user_id, {
        email: guest.email,
        email_confirm: true,
      });
      if (error) throw error;
      authEmailChanged = true;
    }

    const { error: updateError } = await admin.from("users").update({
      full_name: guest.full_name,
      email: guest.email,
      phone: guest.phone,
      address: guest.address,
      birthday: guest.birthday,
      age: guest.age,
      emergency_contact_name: guest.emergency_contact_name,
      emergency_contact_phone: guest.emergency_contact_phone,
    }).eq("user_id", id).eq("user_type", "Guest");
    if (updateError) {
      if (authEmailChanged && existing.auth_user_id) {
        const { error: rollbackError } = await admin.auth.admin.updateUserById(existing.auth_user_id, {
          email: oldAuthEmail,
          email_confirm: true,
        });
        if (rollbackError) console.error("Could not restore the guest Auth email after profile update failed:", rollbackError);
      }
      throw updateError;
    }

    if (guest.password && existing.auth_user_id) {
      const { error } = await admin.auth.admin.updateUserById(existing.auth_user_id, { password: guest.password });
      if (error) {
        console.error("Guest profile was updated, but the password update failed:", error);
        return { body: { type: "error", message: "Guest profile was updated, but the password could not be changed." }, status: 500 };
      }
    }
    return { body: { type: "success", message: "Guest account updated." }, status: 200 };
  }

  if (action === "activate" || action === "deactivate") {
    const id = parseId(input.user_id);
    const { data, error } = await admin.from("users")
      .update({ is_active: action === "activate" ? 1 : 0 })
      .eq("user_id", id)
      .eq("user_type", "Guest")
      .select("user_id")
      .maybeSingle();
    if (error) throw error;
    if (!data) return { body: { type: "error", message: "Guest account not found." }, status: 404 };
    return { body: { type: "success", message: action === "activate" ? "Activated" : "Deactivated" }, status: 200 };
  }

  if (action === "delete") {
    const id = parseId(input.user_id);
    const { data: profile, error } = await admin.from("users")
      .select("user_id,auth_user_id,profile_picture")
      .eq("user_id", id)
      .eq("user_type", "Guest")
      .maybeSingle();
    if (error) throw error;
    if (!profile) return { body: { type: "error", message: "Guest account not found." }, status: 404 };
    if (profile.auth_user_id) {
      const { error: deleteError } = await admin.auth.admin.deleteUser(profile.auth_user_id);
      if (deleteError) throw deleteError;
    } else {
      const { error: deleteError } = await admin.from("users")
        .delete()
        .eq("user_id", id)
        .eq("user_type", "Guest");
      if (deleteError) throw deleteError;
    }
    if (
      profile.profile_picture
      && /^[0-9a-f-]{36}\/[A-Za-z0-9._-]+$/i.test(profile.profile_picture)
    ) {
      const { error: pictureError } = await admin.storage
        .from("mbh-profile-pictures")
        .remove([profile.profile_picture]);
      if (pictureError) console.error("Could not remove the deleted guest's profile picture:", pictureError);
    }
    return { body: { type: "success", message: "Deleted" }, status: 200 };
  }

  if (action === "upload_picture") {
    const formData = await request.formData();
    const id = parseId(formData.get("user_id"));
    const file = formData.get("profile_picture");
    if (!(file instanceof File) || !["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024) {
      return { body: { type: "error", message: "Profile picture must be JPG, PNG, or WEBP and 10MB or smaller." }, status: 400 };
    }
    const { data: profile, error: profileError } = await admin.from("users")
      .select("user_id,auth_user_id,profile_picture")
      .eq("user_id", id)
      .eq("user_type", "Guest")
      .maybeSingle();
    if (profileError) throw profileError;
    if (!profile?.auth_user_id) {
      return { body: { type: "error", message: "Guest has no linked Supabase Auth account for profile pictures." }, status: 409 };
    }
    const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const path = `${profile.auth_user_id}/${crypto.randomUUID()}.${extension}`;
    const { error: uploadError } = await admin.storage.from("mbh-profile-pictures").upload(path, file, {
      contentType: file.type,
      upsert: false,
    });
    if (uploadError) throw uploadError;
    const { error: updateError } = await admin.from("users").update({ profile_picture: path })
      .eq("user_id", id)
      .eq("user_type", "Guest");
    if (updateError) {
      const { error: cleanupError } = await admin.storage.from("mbh-profile-pictures").remove([path]);
      if (cleanupError) console.error("Could not remove the unlinked guest picture:", cleanupError);
      throw updateError;
    }
    if (
      profile.profile_picture
      && /^[0-9a-f-]{36}\/[A-Za-z0-9._-]+$/i.test(profile.profile_picture)
    ) {
      const { error: removeError } = await admin.storage
        .from("mbh-profile-pictures")
        .remove([profile.profile_picture]);
      if (removeError) console.error("Could not remove the previous guest picture:", removeError);
    }
    return { body: { type: "success", message: "Profile picture uploaded." }, status: 200 };
  }

  return { body: { type: "error", message: "Invalid guest action." }, status: 400 };
}

Deno.serve(async (request) => {
  const origin = request.headers.get("origin");
  if (origin && !allowedOrigins.has(origin)) return jsonResponse({ type: "error", message: "Origin is not allowed." }, 403, null);
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: jsonResponse({}, 200, origin).headers });
  }
  if (request.method !== "POST") return jsonResponse({ type: "error", message: "Method not allowed." }, 405, origin);

  const auth = await checkAdmin(request);
  if ("error" in auth) return jsonResponse({ type: "error", message: auth.error }, auth.status, origin);

  try {
    let action: string;
    let input: GuestInput = {};
    if (request.headers.get("content-type")?.includes("multipart/form-data")) {
      action = "upload_picture";
    } else {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return jsonResponse({ type: "error", message: "A valid JSON request body is required." }, 400, origin);
      }
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return jsonResponse({ type: "error", message: "A valid JSON request body is required." }, 400, origin);
      }
      const requestBody = body as { action?: unknown; data?: unknown };
      if (typeof requestBody.action !== "string") {
        return jsonResponse({ type: "error", message: "Invalid guest action." }, 400, origin);
      }
      action = requestBody.action;
      input = requestBody.data && typeof requestBody.data === "object" && !Array.isArray(requestBody.data)
        ? requestBody.data as GuestInput
        : {};
    }
    const result = await handleAction(action, input, request);
    return jsonResponse(result.body, result.status, origin);
  } catch (error) {
    console.error("Could not complete the Admin guests action:", error);
    return jsonResponse(
      { type: "error", message: error instanceof Error ? error.message : "Could not complete the guest account action." },
      error instanceof GuestInputError ? 400 : 500,
      origin,
    );
  }
});
