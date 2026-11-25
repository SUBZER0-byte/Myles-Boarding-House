import { describe, expect, it } from "vitest";
import {
  buildAdminBookingPaymentSubmittedMessage,
  buildGuestBookingConfirmedMessage,
  buildGuestBookingRejectedMessage,
  formatPhilippineTimestamp,
} from "../../../supabase/functions/booking-sms-notifications/sms";

describe("booking SMS notifications", () => {
  const details = {
    guestName: "Jordan Reyes",
    bookingId: 42,
    amount: 1250.5,
    timestamp: "Nov 25, 2026 8:00 AM PHT",
  };

  it("includes the guest name, submitted payment amount, and timestamp in the administrator alert", () => {
    expect(buildAdminBookingPaymentSubmittedMessage(details)).toBe(
      "Booking payment submitted for review: Jordan Reyes submitted PHP 1,250.50 (booking #42). Please review the booking payment. Timestamp: Nov 25, 2026 8:00 AM PHT. - Myle's Boarding House",
    );
  });

  it("includes the guest name, confirmed payment amount, and timestamp in the guest confirmation", () => {
    expect(buildGuestBookingConfirmedMessage(details)).toBe(
      "Jordan Reyes, your booking #42 is confirmed. Initial payment confirmed: PHP 1,250.50. Timestamp: Nov 25, 2026 8:00 AM PHT. - Myle's Boarding House",
    );
  });

  it("includes the guest name, payment amount, rejection reason, and timestamp in the guest rejection", () => {
    expect(buildGuestBookingRejectedMessage({
      ...details,
      rejectionReason: "  The transaction reference could not be verified.\nPlease contact us. ",
    })).toBe(
      "Jordan Reyes, your booking #42 payment of PHP 1,250.50 was rejected. Reason: The transaction reference could not be verified. Please contact us. Timestamp: Nov 25, 2026 8:00 AM PHT. - Myle's Boarding House",
    );
  });

  it("formats timestamps in Philippine time regardless of the runtime timezone", () => {
    expect(formatPhilippineTimestamp(new Date("2026-11-25T00:00:00.000Z")))
      .toBe("Nov 25, 2026 8:00 AM PHT");
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
