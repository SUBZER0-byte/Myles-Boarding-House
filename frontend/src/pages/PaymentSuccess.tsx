import { Link } from "react-router-dom";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSupabasePolling } from "@/hooks/useSupabasePolling";
import { sessionStore } from "@/lib/api";
import { listMyGuestBookings } from "@/lib/guestBookings";

export default function PaymentSuccess() {
  const session = sessionStore.get();
  const email = session?.email ?? "";
  const requestedBookingId = Number(new URLSearchParams(window.location.search).get("booking_id"));
  const { data, error } = useSupabasePolling(
    listMyGuestBookings,
    5000,
    Boolean(email),
  );

  const selectedBooking = Number.isSafeInteger(requestedBookingId) && requestedBookingId > 0
    ? data?.find(booking => booking.booking_id === requestedBookingId) ?? null
    : null;
  const confirmed = selectedBooking?.status === "Confirmed" || selectedBooking?.initial_payment_status === "Confirmed";
  const pending = !!email && !!selectedBooking && !confirmed;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="max-w-md w-full text-center space-y-4 p-8 rounded-2xl border border-border bg-card shadow-lg">
        <div className="mx-auto p-3 rounded-full bg-success/10 text-success w-fit">
          <CheckCircle2 size={48} />
        </div>
        <h1 className="font-display text-2xl font-semibold">
          {confirmed ? "Payment Approved" : selectedBooking ? "Waiting for Confirmation" : "Check Booking Status"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {error && selectedBooking
            ? "The system is trying to confirm your payment. This page will refresh automatically every few seconds."
            : confirmed
              ? `Your reservation for Room ${selectedBooking?.room_number ?? "your selected room"} has been confirmed.`
              : pending
                ? "Your payment is still being verified. This page will refresh automatically until the booking is confirmed."
                : email
                  ? "We could not identify a booking for this payment return. Review the booking status in My Booking; do not treat this page as payment confirmation."
                  : "Sign in and open My Booking to verify your reservation status."}
        </p>

        {pending && (
          <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <Loader2 size={14} className="animate-spin" />
            Checking booking status…
          </div>
        )}

        <Button asChild className="w-full"><Link to={email ? "/guest/booking" : "/"}>{email ? "View My Booking" : "Back to Home"}</Link></Button>
      </div>
    </div>
  );
}
