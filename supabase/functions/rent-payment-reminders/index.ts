import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildRentPaymentReminderMessage,
  sendTextBeeSms,
} from "./sms.ts";

interface RentPaymentReminder {
  payment_id: number;
  due_date: string;
  recipient_phone: string;
  amount: number;
  description: string | null;
  attempt_count: number;
}

const jsonResponse = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

Deno.serve(async request => {
  if (request.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed." });
  }

  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const cronSecret = Deno.env.get("RENT_PAYMENT_REMINDER_CRON_SECRET");
  if (!serviceRoleKey || !cronSecret || request.headers.get("x-cron-secret") !== cronSecret) {
    return jsonResponse(401, { error: "Unauthorized." });
  }

  if (Deno.env.get("RENT_PAYMENT_REMINDER_ENABLED")?.toLowerCase() !== "true") {
    return jsonResponse(503, { error: "Rent payment reminder SMS is disabled." });
  }
  const apiKey = Deno.env.get("TEXTBEE_API_KEY")?.trim();
  const apiBase = Deno.env.get("TEXTBEE_API_BASE")?.trim();
  if (!apiKey || !apiBase) {
    return jsonResponse(503, { error: "TextBee API credentials are not configured." });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  if (!supabaseUrl) {
    return jsonResponse(503, { error: "Supabase URL is not configured." });
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: reminders, error: claimError } = await supabase.rpc(
    "claim_rent_payment_sms_reminders",
  );
  if (claimError) {
    console.error("Could not claim rent payment reminders:", claimError.message);
    return jsonResponse(500, { error: "Could not load upcoming rent reminders." });
  }
  if (!Array.isArray(reminders)) {
    return jsonResponse(500, { error: "The rent reminder service returned invalid data." });
  }

  let sent = 0;
  let failed = 0;
  for (const reminder of reminders as RentPaymentReminder[]) {
    let sendError: string | null = null;
    try {
      const message = buildRentPaymentReminderMessage(
        Number(reminder.amount),
        reminder.due_date,
      );
      await sendTextBeeSms(reminder.recipient_phone, message, {
        apiBase,
        apiKey,
        deviceId: Deno.env.get("TEXTBEE_DEVICE_ID")?.trim() || undefined,
      });
    } catch (error) {
      sendError = error instanceof Error ? error.message : "Unexpected TextBee error.";
    }

    const { error: finishError } = await supabase.rpc(
      "finish_rent_payment_sms_reminder",
      {
        p_payment_id: reminder.payment_id,
        p_success: sendError === null,
        p_error: sendError,
      },
    );
    if (finishError) {
      failed += 1;
      console.error(
        `Could not record rent reminder result for payment ${reminder.payment_id}:`,
        finishError.message,
      );
      continue;
    }
    if (sendError) {
      failed += 1;
      console.error(`Rent reminder SMS failed for payment ${reminder.payment_id}:`, sendError);
    } else {
      sent += 1;
    }
  }

  return jsonResponse(200, {
    claimed: reminders.length,
    sent,
    failed,
  });
});
