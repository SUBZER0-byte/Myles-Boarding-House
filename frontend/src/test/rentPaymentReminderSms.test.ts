import { describe, expect, it, vi } from "vitest";
import {
  buildRentPaymentReminderMessage,
  normalizePhilippineSmsPhone,
  sendTextBeeSms,
} from "../../../supabase/functions/rent-payment-reminders/sms";

describe("rent payment reminder SMS", () => {
  it.each([
    ["09171234567", "+639171234567"],
    ["639171234567", "+639171234567"],
    ["+639171234567", "+639171234567"],
    ["9 171 234 567", "+639171234567"],
  ])("normalizes the registered OTP phone format %s", (phone, normalized) => {
    expect(normalizePhilippineSmsPhone(phone)).toBe(normalized);
  });

  it("rejects phone numbers outside the registered Philippine mobile format", () => {
    expect(() => normalizePhilippineSmsPhone("12345")).toThrow(
      "Phone number is not a valid Philippine mobile number.",
    );
  });

  it("includes the exact due date and five-day notice in the SMS", () => {
    expect(buildRentPaymentReminderMessage(6500, "2026-11-23")).toBe(
      "Reminder: your rent payment of PHP 6,500.00 is due on 2026-11-23 (in 5 days). Please pay before the due date. - Myle's Boarding House",
    );
  });

  it("uses the same TextBee endpoint, header, and recipient payload as registration OTP", async () => {
    const fetcher = vi.fn(async () => new Response('{"status":"queued"}', { status: 200 }));

    await sendTextBeeSms(
      "09171234567",
      "Rent is due soon.",
      {
        apiBase: "https://textbee.example/",
        apiKey: "test-key",
        deviceId: "test-device",
      },
      fetcher,
    );

    expect(fetcher).toHaveBeenCalledWith(
      "https://textbee.example/gateway/send-sms",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": "test-key",
        },
        body: JSON.stringify({
          recipients: ["+639171234567"],
          message: "Rent is due soon.",
          deviceId: "test-device",
        }),
      }),
    );
  });

  it("reports unsuccessful or invalid TextBee responses as delivery failures", async () => {
    const rejected = vi.fn(async () => new Response("{}", { status: 503 }));
    await expect(sendTextBeeSms("09171234567", "Reminder.", {
      apiBase: "https://textbee.example",
      apiKey: "test-key",
    }, rejected)).rejects.toThrow("TextBee rejected SMS with HTTP 503.");

    const invalidBody = vi.fn(async () => new Response('"queued"', { status: 200 }));
    await expect(sendTextBeeSms("09171234567", "Reminder.", {
      apiBase: "https://textbee.example",
      apiKey: "test-key",
    }, invalidBody)).rejects.toThrow("TextBee returned an invalid response with HTTP 200.");
  });
});
