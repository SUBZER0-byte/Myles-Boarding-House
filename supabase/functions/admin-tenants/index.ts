import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const allowedOrigins = new Set(
  (Deno.env.get("APP_ALLOWED_ORIGINS") ?? "https://myles-boarding-house.vercel.app")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);

if (!supabaseUrl || !serviceRoleKey) throw new Error("Supabase function secrets are not configured.");

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

type TenantInput = Record<string, unknown> & {
  tenant_id?: unknown;
  username?: unknown;
  email?: unknown;
  new_password?: unknown;
};

class TenantInputError extends Error {}

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

function id(value: unknown): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result <= 0) throw new TenantInputError("Invalid tenant record.");
  return result;
}

function phone(value: unknown, optional = false): string {
  const digits = text(value).replace(/\D/g, "");
  if (!digits && optional) return "";
  const normalized = digits.startsWith("63")
    ? `0${digits.slice(2)}`
    : digits.length === 10 && digits.startsWith("9") ? `0${digits}` : digits;
  if (!/^09\d{9}$/.test(normalized)) {
    throw new TenantInputError("Enter a valid Philippines mobile number in the format 09XXXXXXXXX.");
  }
  return normalized;
}

function validDate(value: unknown, label: string, optional = false): string {
  const date = text(value);
  if (!date && optional) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new TenantInputError(`Enter a valid ${label}.`);
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new TenantInputError(`Enter a valid ${label}.`);
  }
  return date;
}

function calculateAge(birthday: string): number | null {
  if (!birthday) return null;
  const [year, month, day] = birthday.split("-").map(Number);
  const today = new Date();
  let age = today.getUTCFullYear() - year;
  if (
    today.getUTCMonth() + 1 < month
    || (today.getUTCMonth() + 1 === month && today.getUTCDate() < day)
  ) age -= 1;
  if (age < 0 || age > 120) throw new TenantInputError("Enter a valid birthday that is not in the future.");
  return age;
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
    console.error("Could not verify the Admin tenants caller:", error);
    return { error: "Could not verify the account.", status: 500 } as const;
  }
  if (!profile || profile.user_type !== "Admin" || profile.is_active !== 1) {
    return { error: "Administrator access is required.", status: 403 } as const;
  }
  return { user: authData.user } as const;
}

async function linkedAccount(action: string, input: TenantInput) {
  if (action === "update" && input.tenant_id !== undefined) {
    const { data: tenant, error } = await admin
      .from("tenants")
      .select("user_id")
      .eq("tenant_id", id(input.tenant_id))
      .maybeSingle();
    if (error) throw error;
    if (tenant?.user_id) {
      const { data, error: userError } = await admin
        .from("users")
        .select("user_id,auth_user_id,email")
        .eq("user_id", tenant.user_id)
        .maybeSingle();
      if (userError) throw userError;
      return data;
    }
  }
  const username = text(input.username);
  if (!username) return null;
  const { data, error } = await admin
    .from("users")
    .select("user_id,auth_user_id,email")
    .eq("username", username)
    .eq("user_type", "Tenant")
    .eq("is_active", 1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

function validatedInput(action: string, input: TenantInput): Record<string, unknown> {
  const fullName = text(input.full_name);
  const email = text(input.email).toLowerCase();
  const mobile = phone(input.phone);
  const address = text(input.address);
  const emergencyName = text(input.emergency_contact_name);
  const emergencyPhone = phone(input.emergency_contact_phone, true);
  const username = text(input.username);
  const moveInDate = validDate(input.move_in_date, "move-in date");
  const moveOutDate = validDate(input.move_out_date, "move-out date", true);
  const birthday = validDate(input.birthday, "birthday", true);
  const newPassword = typeof input.new_password === "string" ? input.new_password : "";
  const roomIdText = text(input.room_id);

  if (!/^[\p{L} .'-]{2,150}$/u.test(fullName)) {
    throw new TenantInputError("Enter a valid full name (2–150 characters).");
  }
  if (email.length > 150 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new TenantInputError("Enter a valid email address (maximum 150 characters).");
  }
  if (address.length > 255 || emergencyName.length > 150) {
    throw new TenantInputError("Address or emergency contact name is too long.");
  }
  if (moveOutDate && moveOutDate <= moveInDate) {
    throw new TenantInputError("Move-out date must be after the move-in date.");
  }
  if (username && !/^[A-Za-z0-9._-]{3,50}$/.test(username)) {
    throw new TenantInputError("Username must be 3–50 characters and use only letters, numbers, dots, underscores, or hyphens.");
  }
  if (newPassword && (newPassword.length < 6 || newPassword.length > 200)) {
    throw new TenantInputError("New password must be 6–200 characters long.");
  }
  if (roomIdText && (!/^[1-9]\d*$/.test(roomIdText) || !Number.isSafeInteger(Number(roomIdText)))) {
    throw new TenantInputError("Select a valid room.");
  }
  if (action === "update") id(input.tenant_id);
  if (action === "create" && newPassword) {
    throw new TenantInputError("A tenant account must be linked before changing its password.");
  }

  return {
    ...input,
    tenant_id: action === "update" ? id(input.tenant_id) : undefined,
    full_name: fullName,
    email,
    phone: mobile,
    address,
    birthday,
    emergency_contact_name: emergencyName,
    emergency_contact_phone: emergencyPhone,
    username,
    room_id: roomIdText,
    move_in_date: moveInDate,
    move_out_date: moveOutDate,
    age: calculateAge(birthday),
  };
}

async function handleAction(action: string, input: TenantInput, authUserId: string) {
  if (!["list", "suggestions", "create", "update", "deactivate", "delete"].includes(action)) {
    return { body: { type: "error", message: "Invalid tenant action." }, status: 400 };
  }
  if (action === "list" || action === "suggestions" || action === "deactivate" || action === "delete") {
    const data = action === "deactivate" || action === "delete" ? { tenant_id: id(input.tenant_id) } : input;
    const { data: response, error } = await admin.rpc("manage_my_admin_tenants", {
      p_action: action,
      p_auth_user_id: authUserId,
      p_data: data,
    });
    if (error) throw error;
    if (!response || response.type !== "success") {
      return { body: response ?? { type: "error", message: "The tenant service returned an invalid response." }, status: 400 };
    }
    return { body: response, status: 200 };
  }

  const data = validatedInput(action, input);
  const account = await linkedAccount(action, input);
  const authId = account?.auth_user_id;
  const password = typeof input.new_password === "string" ? input.new_password : "";
  if (password && !authId) {
    throw new TenantInputError("Link a Tenant login before changing its password.");
  }
  const email = text(data.email);
  let oldAuthEmail: string | null = null;
  let authEmailChanged = false;
  if (authId) {
    const { data: authAccount, error: readError } = await admin.auth.admin.getUserById(authId);
    if (readError) throw readError;
    oldAuthEmail = authAccount.user.email ?? "";
    if (oldAuthEmail.toLowerCase() !== email) {
      const { error } = await admin.auth.admin.updateUserById(authId, {
        email,
        email_confirm: true,
      });
      if (error) throw error;
      authEmailChanged = true;
    }
  }

  const profileData = { ...data };
  delete profileData.new_password;
  const { data: response, error } = await admin.rpc("manage_my_admin_tenants", {
    p_action: action,
    p_auth_user_id: authUserId,
    p_data: profileData,
  });
  if (error || !response || response.type !== "success") {
    if (authEmailChanged && authId && oldAuthEmail) {
      const { error: rollbackError } = await admin.auth.admin.updateUserById(authId, {
        email: oldAuthEmail,
        email_confirm: true,
      });
      if (rollbackError) console.error("Could not restore the Tenant Auth email after the profile update failed:", rollbackError);
    }
    if (error) throw error;
    return { body: response ?? { type: "error", message: "The tenant service returned an invalid response." }, status: 400 };
  }

  const linkedUserId = typeof response.user_id === "number" ? response.user_id : account?.user_id;
  if (password && linkedUserId) {
    const { data: profile, error: profileError } = await admin
      .from("users")
      .select("auth_user_id")
      .eq("user_id", linkedUserId)
      .maybeSingle();
    if (profileError) throw profileError;
    if (!profile?.auth_user_id) {
      return { body: { type: "error", message: "Tenant profile was saved, but there is no linked Supabase Auth account for the password update." }, status: 409 };
    }
    const { error: passwordError } = await admin.auth.admin.updateUserById(profile.auth_user_id, { password });
    if (passwordError) {
      console.error("Tenant profile was saved, but its Auth password update failed:", passwordError);
      return { body: { type: "error", message: "Tenant profile was saved, but the password could not be changed." }, status: 500 };
    }
  }
  return { body: response, status: 200 };
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
    let input: TenantInput = {};
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
        return jsonResponse({ type: "error", message: "Invalid tenant action." }, 400, origin);
      }
      action = requestBody.action;
      input = requestBody.data && typeof requestBody.data === "object" && !Array.isArray(requestBody.data)
        ? requestBody.data as TenantInput
        : {};
    }

    if (action === "upload_picture") {
      const formData = await request.formData();
      const userId = id(formData.get("user_id"));
      const file = formData.get("profile_picture");
      if (!(file instanceof File) || !["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024) {
        return jsonResponse({ type: "error", message: "Profile picture must be JPG, PNG, or WEBP and 10MB or smaller." }, 400, origin);
      }
      const { data: profile, error } = await admin.from("users")
        .select("auth_user_id,profile_picture")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw error;
      const { data: tenant, error: tenantError } = await admin.from("tenants")
        .select("tenant_id")
        .eq("user_id", userId)
        .limit(1)
        .maybeSingle();
      if (tenantError) throw tenantError;
      if (!profile?.auth_user_id || !tenant) {
        return jsonResponse({ type: "error", message: "Tenant has no linked Supabase Auth account for profile pictures." }, 409, origin);
      }
      const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
      const path = `${profile.auth_user_id}/${crypto.randomUUID()}.${extension}`;
      const { error: uploadError } = await admin.storage.from("mbh-profile-pictures").upload(path, file, {
        contentType: file.type,
        upsert: false,
      });
      if (uploadError) throw uploadError;
      const { error: updateError } = await admin.from("users").update({ profile_picture: path })
        .eq("user_id", userId);
      if (updateError) {
        const { error: cleanupError } = await admin.storage.from("mbh-profile-pictures").remove([path]);
        if (cleanupError) console.error("Could not remove the unlinked Tenant picture:", cleanupError);
        throw updateError;
      }
      if (profile.profile_picture && /^[0-9a-f-]{36}\/[A-Za-z0-9._-]+$/i.test(profile.profile_picture)) {
        const { error: removeError } = await admin.storage.from("mbh-profile-pictures").remove([profile.profile_picture]);
        if (removeError) console.error("Could not remove the previous Tenant picture:", removeError);
      }
      return jsonResponse({ type: "success", message: "Profile picture uploaded." }, 200, origin);
    }

    const result = await handleAction(action, input, auth.user.id);
    return jsonResponse(result.body, result.status, origin);
  } catch (error) {
    console.error("Could not complete the Admin tenants action:", error);
    return jsonResponse(
      { type: "error", message: error instanceof Error ? error.message : "Could not complete the tenant action." },
      error instanceof TenantInputError ? 400 : 500,
      origin,
    );
  }
});
