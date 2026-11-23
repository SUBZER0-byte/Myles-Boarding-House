import { describe, expect, it } from "vitest";
import {
  buildAdminBookingPaymentSubmittedMessage,
  buildGuestBookingConfirmedMessage,
  buildGuestBookingRejectedMessage,
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

  it("includes the guest name, payment amount, and rejection reason in the guest rejection", () => {
    expect(buildGuestBookingRejectedMessage({
      ...details,
      rejectionReason: "  The transaction reference could not be verified.\nPlease contact us. ",
    })).toBe(
      "Jordan Reyes, your booking #42 payment of PHP 1,250.50 was rejected. Reason: The transaction reference could not be verified. Please contact us. - Myle's Boarding House",
    );
  });

  it("rejects a missing or overlong rejection reason", () => {
    expect(() => buildGuestBookingRejectedMessage({ ...details, rejectionReason: "  " }))
      .toThrow("Booking rejection SMS details are invalid.");
    expect(() => buildGuestBookingRejectedMessage({ ...details, rejectionReason: "x".repeat(301) }))
      .toThrow("Booking rejection SMS details are invalid.");
  });

  it("rejects incomplete or invalid booking message details", () => {
    expect(() => buildGuestBookingConfirmedMessage({ ...details, amount: 0 }))
      .toThrow("Booking SMS details are invalid.");
  });
});
