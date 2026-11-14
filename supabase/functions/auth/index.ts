import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  createSupabaseAdminClient,
  getSupabasePublishableKey,
  getSupabaseServerKey,
  getSupabaseUrl,
} from "../_shared/supabase.ts";
import { isTextBeeEnabled } from "../_shared/textbee.ts";

const supabaseUrl = getSupabaseUrl();
const anonKey = getSupabasePublishableKey();
const serviceRoleKey = getSupabaseServerKey();
const allowedOrigins = new Set(
  (Deno.env.get("APP_ALLOWED_ORIGINS") ?? "https://myles-boarding-house.vercel.app,http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);

const admin = createSupabaseAdminClient();

const encoder = new TextEncoder();
const otpLifetimeMs = 10 * 60 * 1000;
const otpCooldownMs = 60 * 1000;
const maxOtpAttempts = 5;

type AuthAction =
  | "signin"
  | "signup"
  | "check_username"
  | "check_email"
  | "send_otp"
  | "verify_otp"
  | "request_password_reset"
  | "verify_password_reset"
  | "reset_password";

type RequestBody = Record<string, unknown> & { action?: AuthAction };

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

function errorResponse(message: string, status = 400, origin: string | null = null): Response {
  return jsonResponse({ type: "error", message }, status, origin);
}

function normalizePhone(input: unknown): string {
  if (typeof input !== "string") return "";
  const digits = input.replace(/\D/g, "");
  if (/^09\d{9}$/.test(digits)) return `+63${digits.slice(1)}`;
  if (/^639\d{9}$/.test(digits)) return `+${digits}`;
  if (/^9\d{9}$/.test(digits)) return `+63${digits}`;
  return "";
}

function isValidEmail(email: string): boolean {
  return email.length <= 150 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function randomOtp(): string {
  const bytes = crypto.getRandomValues(new Uint32Array(1));
  return String(bytes[0] % 1_000_000).padStart(6, "0");
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hmac(value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(serviceRoleKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function equalHash(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

async function sendTextBeeSms(phone: string, message: string): Promise<void> {
  if (!isTextBeeEnabled(Deno.env.get("TEXTBEE_ENABLED"))) {
    throw new Error("Phone verification is temporarily unavailable.");
  }
  const apiBase = Deno.env.get("TEXTBEE_API_BASE")?.trim().replace(/\/+$/, "");
  const apiKey = Deno.env.get("TEXTBEE_API_KEY")?.trim();
  const deviceId = Deno.env.get("TEXTBEE_DEVICE_ID")?.trim();
  if (!apiBase || !apiKey) {
    throw new Error("Phone verification is temporarily unavailable.");
  }

  const payload: { recipients: string[]; message: string; deviceId?: string } = {
    recipients: [phone],
    message,
  };
  if (deviceId) payload.deviceId = deviceId;

  const response = await fetch(`${apiBase}/gateway/send-sms`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    console.error("TextBee delivery failed with HTTP status", response.status);
    throw new Error("Unable to send the code. Please try again later.");
  }
  try {
    const body: unknown = await response.json();
    if (!body || typeof body !== "object") throw new Error("Invalid TextBee response.");
  } catch {
    console.error("TextBee returned an invalid success response.");
    throw new Error("Unable to send the code. Please try again later.");
  }
}

async function findProfileByIdentifier(identifier: string) {
  const byUsername = await admin
    .from("users")
    .select("user_id,auth_user_id,username,email,phone,is_active")
    .eq("username", identifier)
    .limit(1)
    .maybeSingle();
  if (byUsername.error) throw byUsername.error;
  if (byUsername.data) return byUsername.data;

  const byEmail = await admin
    .from("users")
    .select("user_id,auth_user_id,username,email,phone,is_active")
    .eq("email", identifier.toLowerCase())
    .limit(1)
    .maybeSingle();
  if (byEmail.error) throw byEmail.error;
  return byEmail.data;
}

async function checkAvailability(column: "username" | "email", value: string) {
  const query = admin.from("users").select("user_id").eq(column, value).limit(1);
  const { data, error } = await query;
  if (error) throw error;
  return !data?.length;
}

async function getChallenge(phone: string, purpose: "signup" | "password_reset") {
  const { data, error } = await admin
    .from("auth_otp_challenges")
    .select("phone,purpose,email,auth_user_id,code_hash,expires_at,attempts,verified_at,consumed_at,created_at")
    .eq("phone", phone)
    .eq("purpose", purpose)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function createChallenge(
  phone: string,
  purpose: "signup" | "password_reset",
  email: string | null,
  code: string,
  authUserId: string | null = null,
) {
  const current = await getChallenge(phone, purpose);
  if (current && Date.now() - Date.parse(current.created_at) < otpCooldownMs) {
    throw new Error("Please wait before requesting another code.");
  }

  const { error } = await admin.from("auth_otp_challenges").upsert({
    phone,
    purpose,
    email,
    auth_user_id: authUserId,
    code_hash: await hmac(`${purpose}|${phone}|${code}`),
    expires_at: new Date(Date.now() + otpLifetimeMs).toISOString(),
    attempts: 0,
    verified_at: null,
    consumed_at: null,
    reset_token_hash: null,
    reset_token_expires_at: null,
  }, { onConflict: "phone,purpose" });
  if (error) throw error;
}

async function verifyChallenge(
  phone: string,
  purpose: "signup" | "password_reset",
  code: string,
  expectedAuthUserId?: string,
) {
  const challenge = await getChallenge(phone, purpose);
  if (!challenge || challenge.consumed_at || Date.parse(challenge.expires_at) <= Date.now()) {
    return false;
  }
  if (expectedAuthUserId !== undefined && challenge.auth_user_id !== expectedAuthUserId) return false;
  if (challenge.attempts >= maxOtpAttempts) return false;

  const expectedHash = await hmac(`${purpose}|${phone}|${code}`);
  const verified = equalHash(expectedHash, challenge.code_hash);
  if (challenge.verified_at) return verified;
  if (!verified) {
    const { error } = await admin
      .from("auth_otp_challenges")
      .update({ attempts: challenge.attempts + 1 })
      .eq("phone", phone)
      .eq("purpose", purpose)
      .eq("attempts", challenge.attempts)
      .is("verified_at", null)
      .is("consumed_at", null)
      .gt("expires_at", new Date().toISOString());
    if (error) throw error;
    return false;
  }

  const update = await admin
    .from("auth_otp_challenges")
    .update({
      verified_at: new Date().toISOString(),
    })
    .eq("phone", phone)
    .eq("purpose", purpose)
    .eq("attempts", challenge.attempts)
    .is("verified_at", null)
    .is("consumed_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("phone")
    .maybeSingle();
  if (update.error) throw update.error;
  return verified && Boolean(update.data);
}

async function handleSignIn(body: RequestBody) {
  const identifier = typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!identifier || !password || password.length > 200) {
    return { status: 400, body: { type: "error", message: "Invalid username or password." } };
  }

  const profile = await findProfileByIdentifier(identifier);
  if (!profile?.auth_user_id || !profile.email) {
    return { status: 401, body: { type: "error", message: "Invalid username or password." } };
  }

  const authClient = createClient(supabaseUrl!, anonKey!, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const { data, error } = await authClient.auth.signInWithPassword({
    email: profile.email,
    password,
  });
  if (error || !data.session) {
    return { status: 401, body: { type: "error", message: "Invalid username or password." } };
  }
  if (profile.is_active === 0) {
    return {
      status: 403,
      body: { type: "error", message: "Your account is deactivated. Please contact the administrator." },
    };
  }

  return {
    status: 200,
    body: {
      type: "success",
      session: {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      },
    },
  };
}

async function handleSignUp(body: RequestBody) {
  const fullName = typeof body.full_name === "string" ? body.full_name.trim() : "";
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const phone = normalizePhone(body.phone);
  const address = typeof body.address === "string" ? body.address.trim() : "";
  const birthday = typeof body.birthday === "string" ? body.birthday : "";
  const emergencyContactName = typeof body.emergency_contact_name === "string"
    ? body.emergency_contact_name.trim()
    : "";
  const emergencyContactPhone = normalizePhone(body.emergency_contact_phone);
  const password = typeof body.password === "string" ? body.password : "";
  const otp = typeof body.otp === "string" ? body.otp.trim() : "";
  const age = Number(body.age);

  if (
    fullName.length < 1 || fullName.length > 150
    || username.length < 3 || username.length > 80
    || !isValidEmail(email)
    || !phone
    || address.length < 1 || address.length > 255
    || !/^\d{4}-\d{2}-\d{2}$/.test(birthday)
    || !Number.isInteger(age) || age < 0 || age > 120
    || emergencyContactName.length < 1 || emergencyContactName.length > 150
    || !emergencyContactPhone
    || password.length < 6 || password.length > 200
    || !/^\d{6}$/.test(otp)
  ) {
    return { status: 400, body: { type: "error", message: "Check the registration details and try again." } };
  }

  const challenge = await getChallenge(phone, "signup");
  if (!challenge || challenge.email !== email) {
    return { status: 400, body: { type: "error", message: "Verify your phone number before creating the account." } };
  }
  if (!(await verifyChallenge(phone, "signup", otp))) {
    return { status: 400, body: { type: "error", message: "Invalid or expired OTP." } };
  }
  if (!(await checkAvailability("username", username)) || !(await checkAvailability("email", email))) {
    return { status: 409, body: { type: "error", message: "Username or email is already registered." } };
  }

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: fullName,
      username,
      phone,
      address,
      birthday,
      age,
      emergency_contact_name: emergencyContactName,
      emergency_contact_phone: emergencyContactPhone,
    },
  });
  if (createError || !created.user) {
    console.error("Supabase Auth account creation failed:", createError);
    return { status: 409, body: { type: "error", message: "Account creation failed. Check whether the email or username is already in use." } };
  }

  const authClient = createClient(supabaseUrl!, anonKey!, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const { data, error } = await authClient.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    console.error("New Supabase Auth account could not be signed in:", error);
    return { status: 503, body: { type: "error", message: "Account created, but sign-in could not be completed. Please sign in." } };
  }
  return {
    status: 200,
    body: {
      type: "success",
      message: "Account created successfully.",
      session: {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      },
    },
  };
}

async function handleSendOtp(body: RequestBody) {
  const phone = normalizePhone(body.phone);
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!phone) return { status: 400, body: { type: "error", message: "Enter a valid Philippine mobile number." } };
  if (!isValidEmail(email)) return { status: 400, body: { type: "error", message: "Enter a valid email address." } };

  if (!(await checkAvailability("email", email))) {
    return { status: 409, body: { type: "error", message: "Email address is already registered." } };
  }
  const { data: existingPhone, error } = await admin
    .from("users")
    .select("user_id")
    .eq("phone", phone)
    .limit(1);
  if (error) throw error;
  if (existingPhone?.length) {
    return { status: 409, body: { type: "error", message: "Phone number is already registered." } };
  }

  const code = randomOtp();
  await createChallenge(phone, "signup", email, code);
  try {
    await sendTextBeeSms(phone, `Your Myle's Boarding House verification code is ${code}. It expires in 10 minutes.`);
  } catch (error) {
    await admin.from("auth_otp_challenges").delete().eq("phone", phone).eq("purpose", "signup");
    throw error;
  }
  const bodyResponse: Record<string, unknown> = {
    type: "success",
    message: "OTP sent to your phone. Enter the code below to continue.",
    phone,
  };
  if (Deno.env.get("ALLOW_DEV_OTP") === "true") bodyResponse.code = code;
  return { status: 200, body: bodyResponse };
}

async function handleVerifyOtp(body: RequestBody) {
  const phone = normalizePhone(body.phone);
  const code = typeof body.otp === "string" ? body.otp.trim() : "";
  if (!phone || !/^\d{6}$/.test(code)) {
    return { status: 400, body: { type: "error", message: "Enter a valid phone number and 6-digit code." } };
  }
  const verified = await verifyChallenge(phone, "signup", code);
  if (!verified) return { status: 400, body: { type: "error", message: "Invalid or expired OTP." } };
  return { status: 200, body: { type: "success", message: "OTP verified successfully." } };
}

async function handlePasswordResetRequest(body: RequestBody) {
  const identifier = typeof body.identifier === "string" ? body.identifier.trim() : "";
  if (!identifier) return { status: 400, body: { type: "error", message: "Enter your username or email address." } };

  const genericMessage = "If an account matches that username or email and has a registered phone number, a reset code has been sent.";
  const profile = await findProfileByIdentifier(identifier);
  const phone = profile?.phone ? normalizePhone(profile.phone) : "";
  if (!profile?.auth_user_id || !phone || profile.is_active === 0) {
    return { status: 200, body: { type: "success", message: genericMessage } };
  }

  const code = randomOtp();
  await createChallenge(phone, "password_reset", profile.email, code, profile.auth_user_id);
  try {
    await sendTextBeeSms(phone, `Your Myle's Boarding House password reset code is ${code}. It expires in 10 minutes.`);
  } catch (error) {
    await admin.from("auth_otp_challenges")
      .delete()
      .eq("phone", phone)
      .eq("purpose", "password_reset")
      .eq("auth_user_id", profile.auth_user_id);
    throw error;
  }
  const response: Record<string, unknown> = {
    type: "success",
    message: genericMessage,
    phone_hint: `${phone.slice(0, 3)}${"•".repeat(Math.max(3, phone.length - 5))}${phone.slice(-2)}`,
  };
  if (Deno.env.get("ALLOW_DEV_OTP") === "true") response.code = code;
  return { status: 200, body: response };
}

async function handleVerifyPasswordReset(body: RequestBody) {
  const identifier = typeof body.identifier === "string" ? body.identifier.trim() : "";
  const code = typeof body.otp === "string" ? body.otp.trim() : "";
  const profile = identifier ? await findProfileByIdentifier(identifier) : null;
  const phone = profile?.phone ? normalizePhone(profile.phone) : "";
  if (!profile?.auth_user_id || !phone || !/^\d{6}$/.test(code)) {
    return { status: 400, body: { type: "error", message: "Invalid or expired reset code." } };
  }
  const verified = await verifyChallenge(phone, "password_reset", code, profile.auth_user_id);
  if (!verified) return { status: 400, body: { type: "error", message: "Invalid or expired reset code." } };

  const token = randomToken();
  const { data: resetChallenge, error } = await admin
    .from("auth_otp_challenges")
    .update({
      reset_token_hash: await hmac(`reset|${token}`),
      reset_token_expires_at: new Date(Date.now() + otpLifetimeMs).toISOString(),
    })
    .eq("phone", phone)
    .eq("purpose", "password_reset")
    .eq("auth_user_id", profile.auth_user_id)
    .is("consumed_at", null)
    .select("auth_user_id")
    .maybeSingle();
  if (error) throw error;
  if (!resetChallenge) return { status: 400, body: { type: "error", message: "Invalid or expired reset code." } };
  return {
    status: 200,
    body: { type: "success", message: "Reset code verified.", reset_token: token },
  };
}

async function handlePasswordReset(body: RequestBody) {
  const token = typeof body.reset_token === "string" ? body.reset_token.trim() : "";
  const password = typeof body.new_password === "string" ? body.new_password : "";
  if (!token || password.length < 6 || password.length > 200) {
    return { status: 400, body: { type: "error", message: "Enter a valid reset token and a 6–200 character password." } };
  }

  const resetTokenHash = await hmac(`reset|${token}`);
  const { data: challenge, error: challengeError } = await admin
    .from("auth_otp_challenges")
    .select("phone,auth_user_id")
    .eq("purpose", "password_reset")
    .eq("reset_token_hash", resetTokenHash)
    .is("consumed_at", null)
    .gt("reset_token_expires_at", new Date().toISOString())
    .maybeSingle();
  if (challengeError) throw challengeError;
  if (!challenge?.auth_user_id) {
    return { status: 403, body: { type: "error", message: "Verify a valid reset code before changing your password." } };
  }

  const { data: consumedChallenge, error: consumeError } = await admin
    .from("auth_otp_challenges")
    .update({ consumed_at: new Date().toISOString(), reset_token_hash: null })
    .eq("phone", challenge.phone)
    .eq("auth_user_id", challenge.auth_user_id)
    .eq("purpose", "password_reset")
    .eq("reset_token_hash", resetTokenHash)
    .is("consumed_at", null)
    .gt("reset_token_expires_at", new Date().toISOString())
    .select("auth_user_id")
    .maybeSingle();
  if (consumeError) throw consumeError;
  if (!consumedChallenge) return { status: 403, body: { type: "error", message: "Verify a valid reset code before changing your password." } };

  const { error: updateError } = await admin.auth.admin.updateUserById(challenge.auth_user_id, { password });
  if (updateError) throw updateError;
  return { status: 200, body: { type: "success", message: "Password changed successfully. You can now sign in." } };
}

Deno.serve(async (request) => {
  const origin = request.headers.get("origin");
  if (origin && !allowedOrigins.has(origin)) {
    return errorResponse("Origin is not allowed.", 403);
  }
  if (request.method === "OPTIONS") {
    const preflight = jsonResponse({}, 200, origin);
    return new Response(null, { status: 204, headers: preflight.headers });
  }
  if (request.method !== "POST") {
    return errorResponse("Method not allowed.", 405, origin);
  }

  let body: RequestBody;
  try {
    body = await request.json() as RequestBody;
  } catch {
    return errorResponse("Invalid JSON request body.", 400, origin);
  }

  try {
    let result: { status: number; body: Record<string, unknown> };
    switch (body.action) {
      case "signin":
        result = await handleSignIn(body);
        break;
      case "signup":
        result = await handleSignUp(body);
        break;
      case "check_username":
        if (typeof body.username !== "string" || body.username.trim().length < 3) {
          result = { status: 400, body: { type: "error", message: "Enter a valid username." } };
          break;
        }
        result = { status: 200, body: { type: "success", available: await checkAvailability("username", body.username.trim()) } };
        break;
      case "check_email":
        if (typeof body.email !== "string" || !isValidEmail(body.email.trim())) {
          result = { status: 400, body: { type: "error", message: "Enter a valid email address." } };
          break;
        }
        result = { status: 200, body: { type: "success", available: await checkAvailability("email", body.email.trim().toLowerCase()) } };
        break;
      case "send_otp":
        result = await handleSendOtp(body);
        break;
      case "verify_otp":
        result = await handleVerifyOtp(body);
        break;
      case "request_password_reset":
        result = await handlePasswordResetRequest(body);
        break;
      case "verify_password_reset":
        result = await handleVerifyPasswordReset(body);
        break;
      case "reset_password":
        result = await handlePasswordReset(body);
        break;
      default:
        result = { status: 400, body: { type: "error", message: "Unknown authentication action." } };
    }
    return jsonResponse(result.body, result.status, origin);
  } catch (error) {
    console.error("Auth function failure:", error);
    const message = error instanceof Error ? error.message : "Authentication request failed.";
    const status = message.includes("wait before requesting") ? 429
      : message.includes("temporarily unavailable") || message.includes("Unable to send") ? 503
      : 500;
    const safeMessage = status === 429
      ? "Please wait before requesting another code."
      : status === 503
        ? "The authentication service is temporarily unavailable."
        : "Authentication request failed. Please try again.";
    return errorResponse(safeMessage, status, origin);
  }
});
