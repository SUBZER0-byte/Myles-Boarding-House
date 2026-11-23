import { describe, expect, it } from "vitest";
import {
  buildAdminBookingPaymentSubmittedMessage,
  buildGuestBookingConfirmedMessage,
} from "../../../supabase/functions/booking-sms-notifications/sms";

describe("booking SMS notifications", () => {
  const details = {
    guestName: "Jordan Reyes",
    bookingId: 42,
    amount: 1250.5,
  };

  it("includes the guest name and submitted payment amount in the administrator alert", () => {
    expect(buildAdminBookingPaymentSubmittedMessage(details)).toBe(
      "Booking payment submitted for review: Jordan Reyes submitted PHP 1,250.50 (booking #42). Please review the booking payment. - Myle's Boarding House",
    );
  });

  it("includes the guest name and confirmed payment amount in the guest confirmation", () => {
    expect(buildGuestBookingConfirmedMessage(details)).toBe(
      "Jordan Reyes, your booking #42 is confirmed. Initial payment confirmed: PHP 1,250.50. - Myle's Boarding House",
    );
  });

  it("rejects incomplete or invalid booking message details", () => {
    expect(() => buildGuestBookingConfirmedMessage({ ...details, amount: 0 }))
      .toThrow("Booking SMS details are invalid.");
  });
});
