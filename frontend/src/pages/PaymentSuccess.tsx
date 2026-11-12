import { Link } from "react-router-dom";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePolling } from "@/hooks/usePolling";
import { endpoints, sessionStore } from "@/lib/api";

interface BookingStatus {
  booking_id?: number;
  status?: string;
  initial_payment_status?: string;
  room_number?: string;
  room_type?: string;
}

export default function PaymentSuccess() {
  const session = sessionStore.get();
  const email = session?.email ?? "";
  const { data, error } = usePolling<BookingStatus[]>(
    email ? `${endpoints.guestBooking}?action=check&email=${encodeURIComponent(email)}` : null,
    { intervalMs: 5000 }
  );

  const latestBooking = Array.isArray(data) && data.length > 0 ? data[0] : null;
  const confirmed = latestBooking?.status === "Confirmed" || latestBooking?.initial_payment_status === "Confirmed";
  const pending = !confirmed && !!email;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="max-w-md w-full text-center space-y-4 p-8 rounded-2xl border border-border bg-card shadow-lg">
        <div className="mx-auto p-3 rounded-full bg-success/10 text-success w-fit">
          <CheckCircle2 size={48} />
        </div>
        <h1 className="font-display text-2xl font-semibold">
          {confirmed ? "Payment Approved" : "Waiting for Confirmation"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {error
            ? "The system is trying to confirm your payment. This page will refresh automatically every few seconds."
            : confirmed
              ? `Your reservation for Room ${latestBooking?.room_number ?? "your selected room"} has been confirmed.`
              : pending
                ? "Your payment is still being verified. This page will refresh automatically until the booking is confirmed."
                : "Thanks! You can safely close this tab and return to Myle's Boarding House — your reservation will be confirmed automatically."}
        </p>

        {pending && (
          <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <Loader2 size={14} className="animate-spin" />
            Checking booking status…
          </div>
        )}

        <Button asChild className="w-full"><Link to="/">Back to Home</Link></Button>
      </div>
    </div>
  );
}
