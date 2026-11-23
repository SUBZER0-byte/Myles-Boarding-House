import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  createSupabaseAdminClient,
  getSupabasePublishableKey,
  getSupabaseUrl,
} from "../_shared/supabase.ts";
import { isTextBeeEnabled } from "../_shared/textbee.ts";
import {
  buildAdminCancellationSubmittedMessage,
  buildTenantCancellationApprovedMessage,
  buildTenantCancellationRejectedMessage,
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

type CancellationSmsAction =
  | "cancellation_submitted"
  | "cancellation_approved"
  | "cancellation_rejected";
type CancellationSmsStatus = "sent" | "partial" | "failed" | "in_progress";

interface CancellationRequest {
  cancellation_id: number;
  requested_by: number | null;
  refund_amount: number;
  status: string;
  rejection_reason: string | null;
  acted_by: number | null;
}

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

function isCancellationSmsAction(value: unknown): value is CancellationSmsAction {
  return value === "cancellation_submitted"
    || value === "cancellation_approved"
    || value === "cancellation_rejected";
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
    return jsonResponse({ error: "Sign in to send a cancellation notification." }, 401, origin);
  }

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return jsonResponse({ error: "Invalid cancellation notification request." }, 400, origin);
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return jsonResponse({ error: "Invalid cancellation notification request." }, 400, origin);
  }

  const action = body.action;
  const cancellationId = body.cancellation_id;
  if (
    !isCancellationSmsAction(action)
    || typeof cancellationId !== "number"
    || !Number.isSafeInteger(cancellationId)
    || cancellationId < 1
  ) {
    return jsonResponse({ error: "Choose a valid cancellation notification." }, 400, origin);
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
      console.error("Could not load cancellation SMS actor:", actorError.message);
      return jsonResponse({ error: "Could not verify the cancellation notification request." }, 500, origin);
    }
    if (!actor || actor.is_active !== 1) {
      return jsonResponse({ error: "An active account is required." }, 403, origin);
    }

    const { data: cancellation, error: cancellationError } = await admin
      .from("cancellation_requests")
      .select("cancellation_id,requested_by,refund_amount,status,rejection_reason,acted_by")
      .eq("cancellation_id", cancellationId)
      .maybeSingle();
    if (cancellationError) {
      console.error("Could not load cancellation for SMS:", cancellationError.message);
      return jsonResponse({ error: "Could not load the cancellation notification details." }, 500, origin);
    }
    if (!cancellation) return jsonResponse({ error: "Cancellation request not found." }, 404, origin);

    const isSubmission = action === "cancellation_submitted";
    if (isSubmission) {
      if (actor.user_type !== "Tenant" || cancellation.requested_by !== actor.user_id) {
        return jsonResponse({ error: "You cannot notify administrators about this cancellation." }, 403, origin);
      }
      if (cancellation.status !== "Pending") {
        return jsonResponse({ error: "The cancellation request is not pending review." }, 409, origin);
      }
    } else {
      const expectedStatus = action === "cancellation_approved" ? "Approved" : "Rejected";
      if (actor.user_type !== "Admin") {
        return jsonResponse({ error: "Administrator access is required." }, 403, origin);
      }
      if (cancellation.status !== expectedStatus || cancellation.acted_by !== actor.user_id) {
        return jsonResponse({ error: "Only the administrator who decided this cancellation can notify the tenant." }, 409, origin);
      }
    }

    if (!cancellation.requested_by) {
      return jsonResponse({ error: "The cancellation request has no tenant account." }, 409, origin);
    }
    const { data: tenant, error: tenantError } = await admin
      .from("users")
      .select("user_id,user_type,is_active,full_name,phone")
      .eq("user_id", cancellation.requested_by)
      .maybeSingle();
    if (tenantError) {
      console.error("Could not load cancellation tenant for SMS:", tenantError.message);
      return jsonResponse({ error: "Could not load the tenant notification details." }, 500, origin);
    }
    if (!tenant || tenant.is_active !== 1 || !["Tenant", "Guest"].includes(tenant.user_type)) {
      return jsonResponse({ error: "The tenant account is not available for notification." }, 409, origin);
    }

    if (!isTextBeeEnabled(Deno.env.get("TEXTBEE_ENABLED"))) {
      return jsonResponse({ error: "Cancellation SMS notifications are disabled." }, 503, origin);
    }
    const apiBase = Deno.env.get("TEXTBEE_API_BASE")?.trim();
    const apiKey = Deno.env.get("TEXTBEE_API_KEY")?.trim();
    if (!apiBase || !apiKey) {
      return jsonResponse({ error: "TextBee credentials are not configured." }, 503, origin);
    }
    const deviceId = Deno.env.get("TEXTBEE_DEVICE_ID")?.trim() || undefined;
    const messageDetails = {
      cancellationId,
      tenantName: tenant.full_name,
      refundAmount: Number(cancellation.refund_amount),
    };
    let message: string;
    if (isSubmission) {
      message = buildAdminCancellationSubmittedMessage(messageDetails);
    } else if (action === "cancellation_approved") {
      message = buildTenantCancellationApprovedMessage(messageDetails);
    } else {
      const rejectionReason = cancellation.rejection_reason;
      if (typeof rejectionReason !== "string" || !rejectionReason.trim()) {
        return jsonResponse({ error: "A rejection reason is required before notifying the tenant." }, 409, origin);
      }
      message = buildTenantCancellationRejectedMessage({
        ...messageDetails,
        rejectionReason,
      });
    }

    let recipients: string[];
    let failed = 0;
    if (isSubmission) {
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
          status: "failed" as CancellationSmsStatus,
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
          status: "failed" as CancellationSmsStatus,
          sent: 0,
          failed: Math.max(failed, 1),
          message: "No active administrator has a valid mobile number.",
        }, 200, origin);
      }
    } else {
      if (typeof tenant.phone !== "string" || !tenant.phone.trim()) {
        return jsonResponse({
          status: "failed" as CancellationSmsStatus,
          sent: 0,
          failed: 1,
          message: "The tenant account does not have a phone number.",
        }, 200, origin);
      }
      try {
        recipients = [normalizePhilippineSmsPhone(tenant.phone)];
      } catch {
        return jsonResponse({
          status: "failed" as CancellationSmsStatus,
          sent: 0,
          failed: 1,
          message: "The tenant phone number is not a valid Philippine mobile number.",
        }, 200, origin);
      }
    }

    const { data: claimed, error: claimError } = await admin.rpc(
      "claim_cancellation_sms_notification",
      { p_cancellation_id: cancellationId, p_event_type: action },
    );
    if (claimError) {
      console.error("Could not claim cancellation SMS notification:", claimError.message);
      return jsonResponse({ error: "Could not start the cancellation SMS notification." }, 500, origin);
    }
    if (claimed !== true) {
      const { data: previousAttempt, error: previousAttemptError } = await admin
        .from("cancellation_sms_notification_events")
        .select("status,sent_count,failed_count")
        .eq("cancellation_id", cancellationId)
        .eq("event_type", action)
        .maybeSingle();
      if (previousAttemptError) {
        console.error("Could not load previous cancellation SMS notification:", previousAttemptError.message);
        return jsonResponse({ error: "Could not check the cancellation SMS notification status." }, 500, origin);
      }
      if (!previousAttempt) {
        return jsonResponse({ error: "Could not claim the cancellation SMS notification." }, 500, origin);
      }
      const previousStatus = previousAttempt.status === "sent" || previousAttempt.status === "partial"
        ? previousAttempt.status
        : previousAttempt.status === "failed" ? "failed" : "in_progress";
      return jsonResponse({
        status: previousStatus,
        sent: previousAttempt.sent_count,
        failed: previousAttempt.failed_count,
        message: previousStatus === "in_progress"
          ? "The cancellation SMS notification is already being processed."
          : "This cancellation SMS notification was already processed.",
      }, 200, origin);
    }

    const results = await Promise.all(recipients.map(async recipient => {
      try {
        await sendTextBeeSms(recipient, message, { apiBase, apiKey, deviceId });
        return true;
      } catch (error) {
        console.error(
          `Cancellation SMS delivery failed for request ${cancellationId}:`,
          error instanceof Error ? error.message : "Unexpected TextBee error.",
        );
        return false;
      }
    }));
    const sent = results.filter(Boolean).length;
    failed += results.length - sent;
    const status: Exclude<CancellationSmsStatus, "in_progress"> =
      sent === 0 ? "failed" : failed > 0 ? "partial" : "sent";
    const { error: finishError } = await admin.rpc("finish_cancellation_sms_notification", {
      p_cancellation_id: cancellationId,
      p_event_type: action,
      p_status: status,
      p_sent_count: sent,
      p_failed_count: failed,
      p_error: status === "sent"
        ? null
        : status === "partial" ? "One or more SMS recipients could not be notified." : "No SMS recipients could be notified.",
    });
    if (finishError) {
      console.error("Could not record cancellation SMS notification result:", finishError.message);
      return jsonResponse({ error: "Could not record the cancellation SMS notification result." }, 500, origin);
    }
    return jsonResponse({
      status,
      sent,
      failed,
      ...(status === "partial" ? { message: "Some recipients could not be notified." } : {}),
      ...(status === "failed" ? { message: "No SMS notifications could be sent." } : {}),
    }, 200, origin);
  } catch (error) {
    console.error("Cancellation SMS notification failed:", error);
    return jsonResponse({ error: "Could not send the cancellation SMS notification." }, 500, origin);
  }
});
