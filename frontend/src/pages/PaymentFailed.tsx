import { Link } from "react-router-dom";
import { Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePolling } from "@/hooks/usePolling";
import { endpoints, sessionStore } from "@/lib/api";

interface BookingStatus {
  booking_id?: number;
  status?: string;
  initial_payment_status?: string;
  room_number?: string;
}

export default function PaymentFailed() {
  const session = sessionStore.get();
  const email = session?.email ?? "";
  const { data, error } = usePolling<BookingStatus[]>(
    email ? `${endpoints.guestBooking}?action=check&email=${encodeURIComponent(email)}` : null,
    { intervalMs: 5000 }
  );

  const latestBooking = Array.isArray(data) && data.length > 0 ? data[0] : null;
  const bookingRecovered = latestBooking?.status === "Confirmed" || latestBooking?.initial_payment_status === "Confirmed";
  const stillChecking = !!email && !bookingRecovered && !error;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="max-w-md w-full text-center space-y-4 p-8 rounded-2xl border border-border bg-card shadow-lg">
        <div className="mx-auto p-3 rounded-full bg-destructive/10 text-destructive w-fit">
          <XCircle size={48} />
        </div>
        <h1 className="font-display text-2xl font-semibold">
          {bookingRecovered ? "Payment Confirmed" : "Payment Cancelled"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {bookingRecovered
            ? `Your reservation for Room ${latestBooking?.room_number ?? "your selected room"} has already been confirmed.`
            : error
              ? "We are checking the latest payment status. This page refreshes automatically while the system verifies your booking."
              : stillChecking
                ? "Your payment may still be processing. This page will refresh automatically while the system verifies the latest booking status."
                : "Your payment was not completed. You can close this tab and try again from the booking dialog."}
        </p>

        {stillChecking && (
          <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <Loader2 size={14} className="animate-spin" />
            Checking latest booking status…
          </div>
        )}

        <Button asChild variant="outline" className="w-full"><Link to="/">Back to Home</Link></Button>
      </div>
    </div>
  );
}
