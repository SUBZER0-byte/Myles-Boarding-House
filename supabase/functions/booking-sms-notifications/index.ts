import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  createSupabaseAdminClient,
  getSupabasePublishableKey,
  getSupabaseUrl,
} from "../_shared/supabase.ts";
import { isTextBeeEnabled } from "../_shared/textbee.ts";
import {
  buildAdminBookingPaymentSubmittedMessage,
  buildGuestBookingConfirmedMessage,
  normalizePhilippineSmsPhone,
  sendTextBeeSms,
} from "./sms.ts";

const supabaseUrl = getSupabaseUrl();
const publishableKey = getSupabasePublishableKey();
const admin = createSupabaseAdminClient();
const allowedOrigins = new Set(
  (Deno.env.get("APP_ALLOWED_ORIGINS") ?? "https://myles-boarding-house.vercel.app,http://localhost:5173")
    .split(",")
    .map(origin => origin.trim())
    .filter(Boolean),
);

type BookingSmsAction = "payment_submitted" | "booking_confirmed";
type BookingSmsStatus = "sent" | "partial" | "failed" | "in_progress";

function responseHeaders(origin: string | null): Headers {
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
  return headers;
}

function jsonResponse(body: Record<string, unknown>, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), { status, headers: responseHeaders(origin) });
}

function isBookingSmsAction(value: unknown): value is BookingSmsAction {
  return value === "payment_submitted" || value === "booking_confirmed";
}

Deno.serve(async request => {
  const origin = request.headers.get("Origin");
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: responseHeaders(origin) });
  }
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405, origin);
  }

  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return jsonResponse({ error: "Sign in to send a booking notification." }, 401, origin);
  }

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return jsonResponse({ error: "Invalid booking notification request." }, 400, origin);
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return jsonResponse({ error: "Invalid booking notification request." }, 400, origin);
  }

  const action = body.action;
  const bookingId = body.booking_id;
  if (
    !isBookingSmsAction(action)
    || typeof bookingId !== "number"
    || !Number.isSafeInteger(bookingId)
    || bookingId < 1
  ) {
    return jsonResponse({ error: "Choose a valid booking notification." }, 400, origin);
  }

  try {
    const authClient = createClient(supabaseUrl, publishableKey, {
      global: { headers: { Authorization: authorization } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: authData, error: authError } = await authClient.auth.getUser();
    if (authError || !authData.user) {
      return jsonResponse({ error: "Your session is invalid. Sign in again." }, 401, origin);
    }

    const { data: actor, error: actorError } = await admin
      .from("users")
      .select("user_id,user_type,is_active")
      .eq("auth_user_id", authData.user.id)
      .maybeSingle();
    if (actorError) {
      console.error("Could not load booking SMS actor:", actorError.message);
      return jsonResponse({ error: "Could not verify the booking notification request." }, 500, origin);
    }
    if (!actor || actor.is_active !== 1) {
      return jsonResponse({ error: "An active account is required." }, 403, origin);
    }

    const { data: booking, error: bookingError } = await admin
      .from("bookings")
      .select("booking_id,guest_user_id,full_name,phone,status")
      .eq("booking_id", bookingId)
      .maybeSingle();
    if (bookingError) {
      console.error("Could not load booking for SMS:", bookingError.message);
      return jsonResponse({ error: "Could not load the booking notification details." }, 500, origin);
    }
    if (!booking) return jsonResponse({ error: "Booking not found." }, 404, origin);

    const isPaymentSubmission = action === "payment_submitted";
    if (isPaymentSubmission) {
      if (actor.user_type !== "Guest" || booking.guest_user_id !== actor.user_id) {
        return jsonResponse({ error: "You cannot notify administrators about this booking." }, 403, origin);
      }
      if (!["Pending Verification", "Confirmed"].includes(booking.status)) {
        return jsonResponse({ error: "The booking payment has not been submitted for review." }, 409, origin);
      }
    } else if (actor.user_type !== "Admin") {
      return jsonResponse({ error: "Administrator access is required." }, 403, origin);
    }

    const { data: initialPayment, error: paymentError } = await admin
      .from("booking_initial_payment_requests")
      .select("amount,status")
      .eq("booking_id", bookingId)
      .maybeSingle();
    if (paymentError) {
      console.error("Could not load initial payment for SMS:", paymentError.message);
      return jsonResponse({ error: "Could not load the booking payment details." }, 500, origin);
    }
    if (
      !initialPayment
      || (isPaymentSubmission && !["Submitted", "Confirmed"].includes(initialPayment.status))
      || (!isPaymentSubmission && initialPayment.status !== "Confirmed")
    ) {
      return jsonResponse({ error: "The booking payment is not in the required status." }, 409, origin);
    }

    if (!isPaymentSubmission) {
      if (booking.status !== "Confirmed") {
        return jsonResponse({ error: "The booking is not confirmed." }, 409, origin);
      }
      const { data: confirmedPayment, error: confirmedPaymentError } = await admin
        .from("payments")
        .select("confirmed_by")
        .eq("booking_id", bookingId)
        .eq("payment_type", "Initial Booking Payment")
        .eq("status", "Confirmed")
        .maybeSingle();
      if (confirmedPaymentError) {
        console.error("Could not verify booking confirmation for SMS:", confirmedPaymentError.message);
        return jsonResponse({ error: "Could not verify the booking confirmation." }, 500, origin);
      }
      if (!confirmedPayment || confirmedPayment.confirmed_by !== actor.user_id) {
        return jsonResponse({ error: "Only the administrator who confirmed the payment can send this notification." }, 403, origin);
      }
    }

    if (!isTextBeeEnabled(Deno.env.get("TEXTBEE_ENABLED"))) {
      return jsonResponse({ error: "Booking SMS notifications are disabled." }, 503, origin);
    }
    const apiBase = Deno.env.get("TEXTBEE_API_BASE")?.trim();
    const apiKey = Deno.env.get("TEXTBEE_API_KEY")?.trim();
    if (!apiBase || !apiKey) {
      return jsonResponse({ error: "TextBee credentials are not configured." }, 503, origin);
    }
    const deviceId = Deno.env.get("TEXTBEE_DEVICE_ID")?.trim() || undefined;
    const details = {
      guestName: booking.full_name,
      bookingId,
      amount: Number(initialPayment.amount),
    };
    const message = isPaymentSubmission
      ? buildAdminBookingPaymentSubmittedMessage(details)
      : buildGuestBookingConfirmedMessage(details);

    let recipients: string[];
    let failed = 0;
    if (isPaymentSubmission) {
      const { data: administrators, error: administratorError } = await admin
        .from("users")
        .select("phone")
        .eq("user_type", "Admin")
        .eq("is_active", 1);
      if (administratorError) {
        console.error("Could not load administrator SMS recipients:", administratorError.message);
        return jsonResponse({ error: "Could not load administrator phone numbers." }, 500, origin);
      }
      if (!administrators?.length) {
        return jsonResponse({
          status: "failed" as BookingSmsStatus,
          sent: 0,
          failed: 1,
          message: "No active administrator accounts were found.",
        }, 200, origin);
      }

      const uniqueNumbers = new Set<string>();
      for (const administrator of administrators) {
        if (typeof administrator.phone !== "string" || !administrator.phone.trim()) {
          failed += 1;
          continue;
        }
        try {
          uniqueNumbers.add(normalizePhilippineSmsPhone(administrator.phone));
        } catch {
          failed += 1;
        }
      }
      recipients = [...uniqueNumbers];
      if (!recipients.length) {
        return jsonResponse({
          status: "failed" as BookingSmsStatus,
          sent: 0,
          failed: Math.max(failed, 1),
          message: "No active administrator has a valid mobile number.",
        }, 200, origin);
      }
    } else {
      if (typeof booking.phone !== "string" || !booking.phone.trim()) {
        return jsonResponse({
          status: "failed" as BookingSmsStatus,
          sent: 0,
          failed: 1,
          message: "The booking does not have a guest phone number.",
        }, 200, origin);
      }
      try {
        recipients = [normalizePhilippineSmsPhone(booking.phone)];
      } catch {
        return jsonResponse({
          status: "failed" as BookingSmsStatus,
          sent: 0,
          failed: 1,
          message: "The guest phone number is not a valid Philippine mobile number.",
        }, 200, origin);
      }
    }

    const { data: claimed, error: claimError } = await admin.rpc(
      "claim_booking_sms_notification",
      { p_booking_id: bookingId, p_event_type: action },
    );
    if (claimError) {
      console.error("Could not claim booking SMS notification:", claimError.message);
      return jsonResponse({ error: "Could not start the booking SMS notification." }, 500, origin);
    }
    if (claimed !== true) {
      const { data: previousAttempt, error: previousAttemptError } = await admin
        .from("booking_sms_notification_events")
        .select("status,sent_count,failed_count")
        .eq("booking_id", bookingId)
        .eq("event_type", action)
        .maybeSingle();
      if (previousAttemptError) {
        console.error("Could not load previous booking SMS notification:", previousAttemptError.message);
        return jsonResponse({ error: "Could not check the booking SMS notification status." }, 500, origin);
      }
      if (!previousAttempt) {
        return jsonResponse({ error: "Could not claim the booking SMS notification." }, 500, origin);
      }
      const previousStatus = previousAttempt.status === "sent" || previousAttempt.status === "partial"
        ? previousAttempt.status
        : previousAttempt.status === "failed" ? "failed" : "in_progress";
      return jsonResponse({
        status: previousStatus,
        sent: previousAttempt.sent_count,
        failed: previousAttempt.failed_count,
        message: previousStatus === "in_progress"
          ? "The booking SMS notification is already being processed."
          : "This booking SMS notification was already processed.",
      }, 200, origin);
    }

    const results = await Promise.all(recipients.map(async recipient => {
      try {
        await sendTextBeeSms(recipient, message, { apiBase, apiKey, deviceId });
        return true;
      } catch (error) {
        console.error(
          `Booking SMS delivery failed for booking ${bookingId}:`,
          error instanceof Error ? error.message : "Unexpected TextBee error.",
        );
        return false;
      }
    }));
    const sent = results.filter(Boolean).length;
    failed += results.length - sent;
    const status: Exclude<BookingSmsStatus, "in_progress"> =
      sent === 0 ? "failed" : failed > 0 ? "partial" : "sent";
    const { error: finishError } = await admin.rpc("finish_booking_sms_notification", {
      p_booking_id: bookingId,
      p_event_type: action,
      p_status: status,
      p_sent_count: sent,
      p_failed_count: failed,
      p_error: status === "sent"
        ? null
        : status === "partial" ? "One or more SMS recipients could not be notified." : "No SMS recipients could be notified.",
    });
    if (finishError) {
      console.error("Could not record booking SMS notification result:", finishError.message);
      return jsonResponse({ error: "Could not record the booking SMS notification result." }, 500, origin);
    }
    return jsonResponse({
      status,
      sent,
      failed,
      ...(status === "partial" ? { message: "Some recipients could not be notified." } : {}),
      ...(status === "failed" ? { message: "No SMS notifications could be sent." } : {}),
    }, 200, origin);
  } catch (error) {
    console.error("Booking SMS notification failed:", error);
    return jsonResponse({ error: "Could not send the booking SMS notification." }, 500, origin);
  }
});
