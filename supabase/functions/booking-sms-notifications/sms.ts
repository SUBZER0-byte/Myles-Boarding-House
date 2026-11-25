import {
  normalizePhilippineSmsPhone,
  sendTextBeeSms,
} from "../rent-payment-reminders/sms.ts";

export { normalizePhilippineSmsPhone, sendTextBeeSms };

interface BookingSmsDetails {
  guestName: string;
  bookingId: number;
  amount: number;
  timestamp: string;
}

interface BookingRejectionSmsDetails extends BookingSmsDetails {
  rejectionReason: string;
}

function formatBookingSmsDetails({ guestName, bookingId, amount }: BookingSmsDetails) {
  const name = guestName.trim();
  if (
    !name
    || !Number.isSafeInteger(bookingId)
    || bookingId < 1
    || !Number.isFinite(amount)
    || amount <= 0
  ) {
    throw new Error("Booking SMS details are invalid.");
  }
  const formattedAmount = new Intl.NumberFormat("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
  return { name, formattedAmount };
}

export function formatPhilippineTimestamp(date: Date = new Date()): string {
  if (Number.isNaN(date.getTime())) {
    throw new Error("Booking SMS timestamp is invalid.");
  }
  const parts = new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find(value => value.type === type)?.value ?? "";
  return `${part("month")} ${part("day")}, ${part("year")} ${part("hour")}:${part("minute")} ${part("dayPeriod")} PHT`;
}

export function buildAdminBookingPaymentSubmittedMessage(details: BookingSmsDetails): string {
  const { name, formattedAmount } = formatBookingSmsDetails(details);
  return `Booking payment submitted for review: ${name} submitted PHP ${formattedAmount} (booking #${details.bookingId}). Please review the booking payment. Timestamp: ${details.timestamp}. - Myle's Boarding House`;
}

export function buildGuestBookingConfirmedMessage(details: BookingSmsDetails): string {
  const { name, formattedAmount } = formatBookingSmsDetails(details);
  return `${name}, your booking #${details.bookingId} is confirmed. Initial payment confirmed: PHP ${formattedAmount}. Timestamp: ${details.timestamp}. - Myle's Boarding House`;
}

export function buildGuestBookingRejectedMessage(details: BookingRejectionSmsDetails): string {
  const { name, formattedAmount } = formatBookingSmsDetails(details);
  const rejectionReason = details.rejectionReason.trim().replace(/\s+/g, " ");
  if (!rejectionReason || rejectionReason.length > 300) {
    throw new Error("Booking rejection SMS details are invalid.");
  }
  return `${name}, your booking #${details.bookingId} payment of PHP ${formattedAmount} was rejected. Reason: ${rejectionReason} Timestamp: ${details.timestamp}. - Myle's Boarding House`;
}
