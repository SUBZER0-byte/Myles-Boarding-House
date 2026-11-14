import { DashboardLayout } from "@/components/DashboardLayout";
import { BookingPaymentDialog } from "@/components/BookingPaymentDialog";
import { RefundRequestButton, RefundRequestHistory } from "@/components/RefundRequests";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  BedDouble, CalendarDays, Clock, CheckCircle2,
  XCircle, Loader2, AlertTriangle, ReceiptText,
} from "lucide-react";
import { useRef, useState } from "react";
import { useSupabasePolling } from "@/hooks/useSupabasePolling";
import { useToast } from "@/hooks/use-toast";
import { sessionStore } from "@/lib/api";
import {
  cancelMyGuestBooking,
  listMyGuestBookings,
  submitMyBookingInitialPayment,
  type GuestBooking as Booking,
} from "@/lib/guestBookings";

/* ── types ──────────────────────────────────────────────────── */
type StatusKey = "Pending" | "Pending Verification" | "Confirmed" | "Checked In" | "Active" | "Checked Out" | "Cancelled" | "Rejected" | "Expired";

const statusStyles: Record<StatusKey, { badge: string; icon: React.ReactNode }> = {
  Pending: {
    badge: "bg-warning/15 text-warning border-warning/30",
    icon: <Clock size={14} className="inline mr-1" />,
  },
  "Pending Verification": {
    badge: "bg-warning/15 text-warning border-warning/30",
    icon: <Clock size={14} className="inline mr-1" />,
  },
  Confirmed: {
    badge: "bg-success/15 text-success border-success/30",
    icon: <CheckCircle2 size={14} className="inline mr-1" />,
  },
  "Checked In": {
    badge: "bg-success/15 text-success border-success/30",
    icon: <CheckCircle2 size={14} className="inline mr-1" />,
  },
  Active: {
    badge: "bg-success/15 text-success border-success/30",
    icon: <CheckCircle2 size={14} className="inline mr-1" />,
  },
  "Checked Out": {
    badge: "bg-muted text-muted-foreground border-border",
    icon: <CheckCircle2 size={14} className="inline mr-1" />,
  },
  Cancelled: {
    badge: "bg-destructive/15 text-destructive border-destructive/30",
    icon: <XCircle size={14} className="inline mr-1" />,
  },
  Rejected: {
    badge: "bg-destructive/15 text-destructive border-destructive/30",
    icon: <XCircle size={14} className="inline mr-1" />,
  },
  Expired: {
    badge: "bg-muted text-muted-foreground border-border",
    icon: <Clock size={14} className="inline mr-1" />,
  },
};

/* ── component ──────────────────────────────────────────────── */
const GuestBooking = () => {
  const { toast } = useToast();
  const session = sessionStore.get();
  const email = session?.email || "";

  const { data: bookings, refetch, error } = useSupabasePolling<Booking[]>(
    listMyGuestBookings,
    10000,
    Boolean(email),
  );

  const [selected, setSelected] = useState<Booking | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentBooking, setPaymentBooking] = useState<Booking | null>(null);
  const paymentSubmissionKey = useRef<string | null>(null);
  const paymentSubmittedRef = useRef(false);

  const openCancel = (b: Booking) => {
    setSelected(b);
    setConfirmOpen(true);
  };

  const openPayment = (booking: Booking) => {
    setPaymentBooking(booking);
    paymentSubmittedRef.current = false;
    setPaymentOpen(true);
  };

  const handleCancel = async () => {
    if (!selected || !email) return;
    setBusy(true);
    try {
      await cancelMyGuestBooking(selected.booking_id);
      toast({
        title: "Booking cancelled",
        description: "Your booking has been cancelled and its reservation released.",
      });
      setConfirmOpen(false);
      setSelected(null);
      refetch();
    } catch (error) {
      toast({
        title: error instanceof Error ? error.message : "Could not cancel booking.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const pastStatuses = ["Cancelled", "Rejected", "Expired", "Checked Out"];
  const active = (bookings || []).filter((b) => !pastStatuses.includes(b.status));
  const past = (bookings || []).filter((b) => pastStatuses.includes(b.status));

  return (
    <DashboardLayout role="guest">
      <div className="space-y-6 max-w-3xl">
        <div>
          <h1 className="font-display text-2xl font-bold">My Booking</h1>
          <p className="text-muted-foreground text-sm mt-1">
            View your current booking status and manage your reservation.
          </p>
        </div>

        {!email && (
          <div className="p-3 rounded-md border border-warning/30 bg-warning/10 text-warning text-xs">
            You're not signed in. Please{" "}
            <a className="underline" href="/login">sign in</a> to view your bookings.
          </div>
        )}

        {error && (
          <div className="p-3 rounded-md border border-destructive/30 bg-destructive/10 text-destructive text-xs">
            Backend unreachable: {error}
          </div>
        )}
        <RefundRequestHistory />

        {/* Loading */}
        {!bookings && email && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 size={14} className="animate-spin" /> Loading your bookings…
          </div>
        )}

        {/* No bookings */}
        {bookings && bookings.length === 0 && (
          <div className="bg-card border border-border rounded-xl p-10 text-center">
            <ReceiptText size={40} className="mx-auto text-muted-foreground mb-3 opacity-40" />
            <p className="font-display font-semibold text-lg">No bookings found</p>
            <p className="text-muted-foreground text-sm mt-1">
              You haven't made any bookings yet. Browse our available rooms to get started.
            </p>
            <Button className="mt-5" onClick={() => (window.location.href = "/guest/rooms")}>
              Browse Rooms
            </Button>
          </div>
        )}

        {/* Active / Confirmed bookings */}
        {active.length > 0 && (
          <div className="space-y-4">
            <h2 className="font-display font-semibold text-base">Active Bookings</h2>
            {active.map((b) => {
              const style = statusStyles[b.status as StatusKey] ?? statusStyles.Pending;
              return (
                <div
                  key={b.booking_id}
                  className="bg-card border border-border rounded-xl p-5 space-y-4"
                >
                  {/* Header */}
                  <div className="flex items-start justify-between flex-wrap gap-3">
                    <div className="flex items-center gap-3">
                      <div className="h-11 w-11 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                        <BedDouble size={20} className="text-primary" />
                      </div>
                      <div>
                        <p className="font-display font-semibold text-base">
                          Room {b.room_number}
                        </p>
                        <p className="text-xs text-muted-foreground">{b.room_type}</p>
                      </div>
                    </div>
                    <span
                      className={`text-xs font-medium px-2.5 py-1 rounded-full border ${style.badge}`}
                    >
                      {style.icon}
                      {b.status}
                    </span>
                  </div>

                  {/* Details grid */}
                  <div className="grid sm:grid-cols-2 gap-3">
                    <InfoRow icon={<BedDouble size={14} />} label="Room Status" value={b.room_status || "—"} />
                    <InfoRow
                      icon={<BedDouble size={14} />}
                      label="Reservation Type"
                      value={`${b.reservation_type === "entire_room" ? "Rent the Entire Room" : "Rent by Capacity"} · ${Number(b.occupant_count || 1)} occupant${Number(b.occupant_count || 1) === 1 ? "" : "s"}`}
                    />
                    <InfoRow
                      icon={<CalendarDays size={14} />}
                      label="Check-in Date"
                      value={b.move_in_date || "—"}
                    />
                    <InfoRow icon={<CalendarDays size={14} />} label="Move-out Date" value={b.check_out_date || "—"} />
                    <InfoRow icon={<ReceiptText size={14} />} label="Payment Plan" value={b.payment_plan || "—"} />
                    {b.payment_plan === "Pay One Month Rent" && (
                      <InfoRow
                        icon={<Clock size={14} />}
                        label="Security Deposit Due"
                        value={`₱${Number(b.monthly_rent || 0).toLocaleString()} at move-in (${b.move_in_date || "move-in date"})`}
                      />
                    )}
                    <InfoRow icon={<ReceiptText size={14} />} label="Total Rent" value={`₱${Number(b.total_rent || 0).toLocaleString()}`} />
                    <InfoRow icon={<CheckCircle2 size={14} />} label="Total Paid" value={`₱${Number(b.amount_paid || 0).toLocaleString()}`} />
                    <InfoRow icon={<Clock size={14} />} label="Remaining Rent Balance" value={`₱${Math.max(0, Number(b.total_rent || 0) - Number(b.amount_paid || 0)).toLocaleString()}`} />
                    <InfoRow icon={<Clock size={14} />} label="Next Payment Due" value={b.next_payment_due || "—"} />
                    <InfoRow
                      icon={<Clock size={14} />}
                      label="Booked On"
                      value={new Date(b.created_at).toLocaleDateString()}
                    />
                    {b.status === "Pending" && Number(b.payment_expires_at_epoch) > 0 && (
                      <InfoRow
                        icon={<Clock size={14} />}
                        label="Payment Deadline"
                        value={new Date(Number(b.payment_expires_at_epoch) * 1000).toLocaleString()}
                      />
                    )}
                    <InfoRow
                      icon={<CheckCircle2 size={14} />}
                      label="Booking ID"
                      value={`#${b.booking_id}`}
                    />
                  </div>

                  {/* Status info banners */}
                  {b.status === "Pending" && (
                    <div className="flex items-start gap-2 p-3 rounded-md bg-warning/10 border border-warning/30 text-warning text-xs">
                      <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                      {b.initial_payment_status === "Submitted"
                        ? "Your payment was submitted and is waiting for admin review."
                        : b.initial_payment_status === "Confirmed" || Number(b.initial_payment_paid) === 1
                          ? "Your initial payment is recorded and your booking is awaiting confirmation."
                          : "Your booking is saved but not complete. Submit the initial payment to finish your booking."}
                    </div>
                  )}
                  {b.status === "Pending Verification" && (
                    <div className="flex items-start gap-2 p-3 rounded-md bg-warning/10 border border-warning/30 text-warning text-xs">
                      <Clock size={14} className="mt-0.5 shrink-0" />
                      Your payment has been successfully submitted! Your reservation is now awaiting administrator verification. Please allow 30–60 minutes for the administrator to verify your payment. You will receive an update once your payment has been reviewed. Your reservation is not yet confirmed.
                    </div>
                  )}
                  {b.status === "Confirmed" && (
                    <div className="flex items-start gap-2 p-3 rounded-md bg-success/10 border border-success/30 text-success text-xs">
                      <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
                      Your booking has been confirmed! Please prepare for your move-in date. You can cancel below if needed.
                    </div>
                  )}
                  {b.status === "Rejected" && (
                    <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/30 text-destructive text-xs">
                      <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                      Your payment was rejected and this reservation is no longer active. Please contact the administrator before submitting a new booking.
                    </div>
                  )}
                  {b.status === "Expired" && (
                    <div className="flex items-start gap-2 p-3 rounded-md bg-muted border border-border text-muted-foreground text-xs">
                      <Clock size={14} className="mt-0.5 shrink-0" />
                      The payment deadline passed before your payment was submitted. This temporary reservation has expired.
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2">
                    {Number(b.amount_paid) > 0 && <RefundRequestButton bookingId={b.booking_id} onSubmitted={refetch} />}
                  </div>

                  {/* Cancel — before or after payment verification */}
                  {(b.status === "Pending" || b.status === "Pending Verification" || b.status === "Confirmed") && (
                    <div className="flex flex-wrap gap-2">
                      {b.status === "Pending"
                        && b.initial_payment_status !== "Submitted"
                        && b.initial_payment_status !== "Confirmed"
                        && Number(b.initial_payment_paid) !== 1 && (
                          <Button onClick={() => openPayment(b)}>
                            Complete Payment · ₱{Number(b.initial_payment_amount || 0).toLocaleString()}
                          </Button>
                        )}
                      <Button
                        variant="outline"
                        className="border-destructive text-destructive hover:bg-destructive/10"
                        onClick={() => openCancel(b)}
                      >
                        <XCircle size={15} className="mr-2" />
                        Cancel Booking
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Finished booking history */}
        {past.length > 0 && (
          <div className="space-y-3">
            <h2 className="font-display font-semibold text-base text-muted-foreground">
              Finished Bookings
            </h2>
            {past.map((b) => (
              <div
                key={b.booking_id}
                className="bg-card border border-border rounded-xl p-4 opacity-70 flex items-center justify-between gap-3 flex-wrap"
              >
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center shrink-0">
                    <BedDouble size={16} className="text-muted-foreground" />
                  </div>
                  <div>
                    <p className="font-medium text-sm">Room {b.room_number}</p>
                    <p className="text-xs text-muted-foreground">
                      {b.reservation_type === "entire_room" ? "Entire room · " : ""}
                      Booked {new Date(b.created_at).toLocaleDateString()} · Move-in {b.move_in_date}
                    </p>
                  </div>
                </div>
                <Badge variant="secondary" className="text-xs">
                  {statusStyles[b.status].icon} {b.status}
                </Badge>
                {Number(b.amount_paid) > 0 && <RefundRequestButton bookingId={b.booking_id} onSubmitted={refetch} />}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Cancel confirmation dialog */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cancel Booking</DialogTitle>
            <DialogDescription>
              Are you sure you want to cancel your booking for{" "}
              <strong>Room {selected?.room_number}</strong>? The room will be
              made available again immediately.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/30 text-destructive text-xs">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            This action cannot be undone. Your reservation will be immediately released.
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="secondary"
              onClick={() => setConfirmOpen(false)}
              disabled={busy}
            >
              Keep My Booking
            </Button>
            <Button variant="destructive" onClick={handleCancel} disabled={busy}>
              {busy ? (
                <>
                  <Loader2 size={14} className="mr-2 animate-spin" />
                  Cancelling…
                </>
              ) : (
                "Yes, Cancel"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <BookingPaymentDialog
        open={paymentOpen}
        onOpenChange={(open) => {
          setPaymentOpen(open);
          if (!open) {
            setPaymentBooking(null);
            paymentSubmissionKey.current = null;
            paymentSubmittedRef.current = false;
          }
        }}
        preventOutsideClose
        onBeforeClose={async () => {
          if (!paymentBooking || paymentSubmittedRef.current) return true;
          try {
            await cancelMyGuestBooking(paymentBooking.booking_id);
            toast({
              title: "Booking cancelled",
              description: "Your reservation was cancelled before payment was submitted.",
            });
            refetch();
            return true;
          } catch (error: unknown) {
            toast({
              title: "Could not cancel booking",
              description: error instanceof Error ? error.message : "Please try again.",
              variant: "destructive",
            });
            return false;
          }
        }}
        roomName={paymentBooking ? `Booking #${paymentBooking.booking_id}` : "your booking"}
        amountPHP={Number(paymentBooking?.initial_payment_amount ?? 0)}
        bookingId={paymentBooking?.booking_id}
        paymentExpiresAtEpoch={paymentBooking?.payment_expires_at_epoch}
        serverNowEpoch={paymentBooking?.server_now_epoch}
        title="Complete Booking Payment"
        description="Complete payment before the deadline. Closing this window before payment is submitted cancels the booking; after submission, it remains awaiting administrator review."
        successTitle="Payment Submitted"
        successDescription="Your payment has been successfully submitted! Your reservation is now awaiting administrator verification. Please allow 30–60 minutes for the administrator to verify your payment. You will receive an update once your payment has been reviewed. Your reservation is not yet confirmed."
        allowScreenshot
        requireReference
        onPaid={async (method, reference, _captureId, _orderId, screenshot) => {
          if (!paymentBooking) throw new Error("Booking reference is missing.");
          paymentSubmissionKey.current ||= crypto.randomUUID();
          await submitMyBookingInitialPayment(
            paymentBooking.booking_id,
            method,
            reference,
            screenshot,
            paymentSubmissionKey.current,
          );
          paymentSubmittedRef.current = true;
          paymentSubmissionKey.current = null;
          toast({ title: "GCash payment submitted for admin review" });
          refetch();
        }}
      />
    </DashboardLayout>
  );
};

/* ── sub-components ──────────────────────────────────────────── */
function InfoRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2 p-3 rounded-md bg-muted/40">
      <span className="text-muted-foreground">{icon}</span>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="font-medium text-sm">{value}</p>
      </div>
    </div>
  );
}

export default GuestBooking;
