import {
  normalizePhilippineSmsPhone,
  sendTextBeeSms,
} from "../rent-payment-reminders/sms.ts";

export { normalizePhilippineSmsPhone, sendTextBeeSms };

interface BookingSmsDetails {
  guestName: string;
  bookingId: number;
  amount: number;
}

function formatBookingSmsDetails({ guestName, bookingId, amount }: BookingSmsDetails) {
  const name = guestName.trim();
  if (!name || !Number.isSafeInteger(bookingId) || bookingId < 1 || !Number.isFinite(amount) || amount <= 0) {
    throw new Error("Booking SMS details are invalid.");
  }
  const formattedAmount = new Intl.NumberFormat("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
  return { name, formattedAmount };
}

export function buildAdminBookingPaymentSubmittedMessage(details: BookingSmsDetails): string {
  const { name, formattedAmount } = formatBookingSmsDetails(details);
  return `Booking payment submitted for review: ${name} submitted PHP ${formattedAmount} (booking #${details.bookingId}). Please review the booking payment. - Myle's Boarding House`;
}

export function buildGuestBookingConfirmedMessage(details: BookingSmsDetails): string {
  const { name, formattedAmount } = formatBookingSmsDetails(details);
  return `${name}, your booking #${details.bookingId} is confirmed. Initial payment confirmed: PHP ${formattedAmount}. - Myle's Boarding House`;
}
