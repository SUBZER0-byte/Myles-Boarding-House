import { Link } from "react-router-dom";
import { Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSupabasePolling } from "@/hooks/useSupabasePolling";
import { sessionStore } from "@/lib/api";
import { listMyGuestBookings } from "@/lib/guestBookings";

export default function PaymentFailed() {
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
  const bookingRecovered = selectedBooking?.status === "Confirmed" || selectedBooking?.initial_payment_status === "Confirmed";
  const stillChecking = !!email && !!selectedBooking && !bookingRecovered;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="max-w-md w-full text-center space-y-4 p-8 rounded-2xl border border-border bg-card shadow-lg">
        <div className="mx-auto p-3 rounded-full bg-destructive/10 text-destructive w-fit">
          <XCircle size={48} />
        </div>
        <h1 className="font-display text-2xl font-semibold">
          {bookingRecovered ? "Payment Confirmed" : selectedBooking ? "Payment Not Completed" : "Check Booking Status"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {bookingRecovered
            ? `Your reservation for Room ${selectedBooking?.room_number ?? "your selected room"} has already been confirmed.`
            : error && selectedBooking
              ? "We are checking the latest payment status. This page refreshes automatically while the system verifies your booking."
              : stillChecking
                ? "Your payment may still be processing. This page will refresh automatically while the system verifies the latest booking status."
                : selectedBooking
                  ? "Your payment was not completed. You can reopen the initial payment from My Booking before the reservation expires."
                  : "We could not identify a booking for this payment return. Review My Booking before retrying; this page does not determine payment status."}
        </p>

        {stillChecking && (
          <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <Loader2 size={14} className="animate-spin" />
            Checking latest booking status…
          </div>
        )}

        <Button asChild variant="outline" className="w-full"><Link to={email ? "/guest/booking" : "/"}>{email ? "View My Booking" : "Back to Home"}</Link></Button>
      </div>
    </div>
  );
}
