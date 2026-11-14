import { DashboardLayout } from "@/components/DashboardLayout";
import { GuestRoomPhotoSlideshow } from "@/components/GuestRoomPhotoSlideshow";
import { BedDouble, CalendarDays, Heart, Loader2, Maximize2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSupabasePolling } from "@/hooks/useSupabasePolling";
import { sessionStore } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { BookingTermsDialog } from "@/components/BookingTermsDialog";
import { BookingPaymentDialog } from "@/components/BookingPaymentDialog";
import { toast } from "@/hooks/use-toast";
import { readSavedRoomIds, writeSavedRoomIds } from "@/lib/savedRooms";
import { addMonths, format } from "date-fns";
import { getPublicRoomsForDates, type PublicRoom } from "@/lib/publicRooms";
import {
  acquireMyGuestRoomHold,
  cancelMyGuestBooking,
  createMyGuestBooking,
  getGuestBookingBoundaryDates,
  releaseMyGuestRoomHold,
  submitMyBookingInitialPayment,
} from "@/lib/guestBookings";

interface RoomBoundaryDates {
  room_id: number;
  dates: string[];
}

const peso = (n: number) =>
  "₱" + (n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });

type StatusKey = "available" | "reserving" | "occupied" | "reserved" | "maintenance";

const statusBadge: Record<StatusKey, string> = {
  available: "bg-success/15 text-success border-success/30",
  reserving: "bg-warning/15 text-warning border-warning/30",
  occupied: "bg-destructive/15 text-destructive border-destructive/30",
  reserved: "bg-warning/15 text-warning border-warning/30",
  maintenance: "bg-muted text-muted-foreground border-border",
};

const GuestRooms = () => {
  const session = sessionStore.get();
  const today = new Date();
  const minimumCheckInDate = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getDate()).padStart(2, "0"),
  ].join("-");
  const [saved, setSaved] = useState<number[]>([]);
  const [quickViewRoom, setQuickViewRoom] = useState<PublicRoom | null>(null);

  // Booking flow state
  const [bookingRoom, setBookingRoom] = useState<PublicRoom | null>(null);
  const [termsOpen, setTermsOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [checkInCalendarOpen, setCheckInCalendarOpen] = useState(false);
  const [checkOutCalendarOpen, setCheckOutCalendarOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [acquiringHold, setAcquiringHold] = useState(false);
  const [acquiringHoldRoomId, setAcquiringHoldRoomId] = useState<number | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [submittedBookingId, setSubmittedBookingId] = useState<number | null>(null);
  const [paymentAmount, setPaymentAmount] = useState(0);
  const [paymentDeadline, setPaymentDeadline] = useState<{ expiresAtEpoch: number; serverNowEpoch: number } | null>(null);
  const bookingRequestKey = useRef<string | null>(null);
  const paymentSubmissionKey = useRef<string | null>(null);
  const paymentSubmittedRef = useRef(false);
  const [form, setForm] = useState({
    full_name: session?.full_name || session?.username || "",
    email: session?.email || "",
    phone: session?.phone || "",
    move_in_date: "",
    check_out_date: "",
    payment_plan: "Pay Monthly",
    notes: "",
  });
  const minimumCheckOutDate = form.move_in_date
    ? format(addMonths(new Date(`${form.move_in_date}T00:00:00`), 1), "yyyy-MM-dd")
    : "";
  const hasAnyDates = Boolean(form.move_in_date || form.check_out_date);
  const hasDateRange = Boolean(form.move_in_date && form.check_out_date
    && form.check_out_date >= minimumCheckOutDate
    && new Date(`${form.move_in_date}T00:00:00`) >= new Date(new Date().toDateString()));
  const invalidDateRange = hasAnyDates && !hasDateRange;
  const roomCheckInDate = hasDateRange ? form.move_in_date : minimumCheckInDate;
  const defaultCheckOutDate = new Date(`${minimumCheckInDate}T00:00:00`);
  defaultCheckOutDate.setDate(defaultCheckOutDate.getDate() + 1);
  const roomCheckOutDate = hasDateRange ? form.check_out_date : format(defaultCheckOutDate, "yyyy-MM-dd");
  const boundaryRoomId = bookingRoom?.room_id;
  const loadRooms = useCallback(
    () => getPublicRoomsForDates(roomCheckInDate, roomCheckOutDate),
    [roomCheckInDate, roomCheckOutDate],
  );
  const { data: rooms, error, refetch: refetchRooms } = useSupabasePolling(loadRooms, 10000);
  const loadBoundaryDates = useCallback(
    () => boundaryRoomId
      ? getGuestBookingBoundaryDates(boundaryRoomId)
      : Promise.resolve({ room_id: 0, dates: [] }),
    [boundaryRoomId],
  );
  const {
    data: scheduledRoomDates,
    loading: loadingScheduledRoomDates,
    error: scheduledRoomDatesError,
    refetch: refetchScheduledRoomDates,
  } = useSupabasePolling<RoomBoundaryDates>(loadBoundaryDates, 60000, Boolean(boundaryRoomId));
  const boundaryDatesReady = Boolean(
    bookingRoom
    && scheduledRoomDates?.room_id === bookingRoom.room_id
    && !scheduledRoomDatesError,
  );
  const unavailableDateSet = useMemo(
    () => new Set(boundaryDatesReady ? scheduledRoomDates?.dates ?? [] : []),
    [boundaryDatesReady, scheduledRoomDates?.dates],
  );
  const unavailableCalendarDates = useMemo(
    () => [...unavailableDateSet].map((date) => new Date(`${date}T00:00:00`)),
    [unavailableDateSet],
  );
  const roomMonthlyRent = Number(bookingRoom?.monthly_rent ?? 0);

  useEffect(() => {
    setSaved(readSavedRoomIds());
  }, []);

  useEffect(() => {
    const currentRoomId = bookingRoom?.room_id;
    if (!currentRoomId || scheduledRoomDates?.room_id !== currentRoomId) return;
    setForm((current) => {
      const moveInDate = unavailableDateSet.has(current.move_in_date) ? "" : current.move_in_date;
      const checkOutDate = unavailableDateSet.has(current.check_out_date) ? "" : current.check_out_date;
      if (moveInDate === current.move_in_date && checkOutDate === current.check_out_date) return current;
      return {
        ...current,
        move_in_date: moveInDate,
        check_out_date: moveInDate ? checkOutDate : "",
      };
    });
  }, [bookingRoom?.room_id, scheduledRoomDates?.room_id, unavailableDateSet]);

  const toggleSave = (id: number) => {
    if (!Number.isSafeInteger(id) || id <= 0) {
      toast({
        title: "Couldn't save room",
        description: "This room has an invalid ID. Refresh the page and try again.",
        variant: "destructive",
      });
      return;
    }

    try {
      const currentSaved = readSavedRoomIds();
      const wasSaved = currentSaved.includes(id);
      const next = wasSaved
        ? currentSaved.filter((savedId) => savedId !== id)
        : [...currentSaved, id];
      writeSavedRoomIds(next);
      setSaved(next);
      toast({
        title: wasSaved ? "Room removed from saved" : "Room saved",
        description: wasSaved ? "You can save it again any time." : "Find it later in your Saved Rooms.",
      });
    } catch {
      toast({
        title: "Couldn't save room",
        description: "Your browser could not store this room. Check your browser storage settings and try again.",
        variant: "destructive",
      });
    }
  };

  const releaseRoomHold = async () => {
    try {
      await releaseMyGuestRoomHold();
      refetchRooms();
    } catch (error: unknown) {
      toast({
        title: "Room hold could not be released",
        description: `${error instanceof Error ? error.message : "Please try again."} It will expire automatically after five minutes.`,
        variant: "destructive",
      });
    }
  };

  const cancelBookingStart = () => {
    setTermsOpen(false);
    setDetailsOpen(false);
    setBookingRoom(null);
    setStep(1);
    bookingRequestKey.current = null;
    void releaseRoomHold();
  };

  const startBooking = async (room: PublicRoom) => {
    if (acquiringHold) return;
    setAcquiringHold(true);
    setAcquiringHoldRoomId(room.room_id);
    try {
      await acquireMyGuestRoomHold({
        room_id: room.room_id,
        ...(hasDateRange && {
          move_in_date: form.move_in_date,
          check_out_date: form.check_out_date,
        }),
      });
      setQuickViewRoom(null);
      setBookingRoom(room);
      bookingRequestKey.current = null;
      paymentSubmissionKey.current = null;
      setStep(1);
      setTermsOpen(true);
      refetchRooms();
      toast({
        title: "Room held for 5 minutes",
        description: "Continue the booking before the hold expires.",
      });
    } catch (error: unknown) {
      toast({
        title: "Unable to reserve room",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
      refetchRooms();
    } finally {
      setAcquiringHold(false);
      setAcquiringHoldRoomId(null);
    }
  };

  const continueToPaymentPlan = async () => {
    if (!bookingRoom || acquiringHold) return;
    setAcquiringHold(true);
    try {
      await acquireMyGuestRoomHold({
        room_id: bookingRoom.room_id,
        move_in_date: form.move_in_date,
        check_out_date: form.check_out_date,
      });
      setStep(2);
      refetchRooms();
    } catch (error: unknown) {
      toast({
        title: "Room unavailable",
        description: error instanceof Error ? error.message : "Please choose another room or date range.",
        variant: "destructive",
      });
      refetchRooms();
    } finally {
      setAcquiringHold(false);
    }
  };

  const submitBooking = async () => {
    if (!bookingRoom || submitting) return;
    setSubmitting(true);
    try {
      bookingRequestKey.current ||= crypto.randomUUID();
      const data = await createMyGuestBooking({
        ...form,
        room_id: bookingRoom.room_id,
        idempotency_key: bookingRequestKey.current,
      });
      paymentSubmittedRef.current = false;
      toast({
        title: "Room temporarily reserved",
        description: "Your booking is saved. Complete the initial payment before the deadline.",
      });
      setDetailsOpen(false);
      setTermsOpen(false);
      setSubmittedBookingId(data.booking_id);
      setPaymentAmount(Number(data.initial_payment_amount ?? initialPayment));
      setPaymentDeadline(
        Number(data.payment_expires_at_epoch) > 0 && Number(data.server_now_epoch) > 0
          ? {
              expiresAtEpoch: Number(data.payment_expires_at_epoch),
              serverNowEpoch: Number(data.server_now_epoch),
            }
          : null,
      );
      refetchRooms();
      setPaymentOpen(true);
      setBookingRoom(null);
      bookingRequestKey.current = null;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Booking failed";
      refetchRooms();
      const availabilityConflict = msg.includes("unavailable for the selected dates")
        || msg.includes("hold expired");
      if (availabilityConflict) setStep(1);
      toast({
        title: availabilityConflict ? "Room unavailable" : "Booking error",
        description: msg,
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const stayMonths = (() => {
    if (!form.move_in_date || !form.check_out_date) return 0;
    const start = new Date(`${form.move_in_date}T00:00:00`);
    const end = new Date(`${form.check_out_date}T00:00:00`);
    const months = (end.getFullYear() - start.getFullYear()) * 12 + end.getMonth() - start.getMonth();
    return Math.max(0, months + (end.getDate() > start.getDate() ? 1 : 0));
  })();
  const totalRent = roomMonthlyRent * stayMonths;
  const securityDeposit = roomMonthlyRent;
  const advanceRent = roomMonthlyRent;
  const initialPayment = form.payment_plan === "Pay One Month Rent"
    ? advanceRent
    : securityDeposit + advanceRent;
  const remainingRent = form.payment_plan === "Pay One Month Rent"
    ? Math.max(0, totalRent - advanceRent)
    : Math.max(0, totalRent - advanceRent - securityDeposit);
  const datesValid = Boolean(
    form.move_in_date >= minimumCheckInDate
    && form.check_out_date >= minimumCheckOutDate
    && boundaryDatesReady
    && !unavailableDateSet.has(form.move_in_date)
    && !unavailableDateSet.has(form.check_out_date),
  );

  return (
    <DashboardLayout role="guest">
      <div className="space-y-6">
        <div>
          <h1 className="font-display text-2xl font-bold">Browse Rooms</h1>
          <p className="text-muted-foreground text-sm mt-1">Choose your stay dates to check room availability before booking.</p>
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">
            Browse current room status and availability for each room.
          </p>
        </div>

        {error && (
          <div className="p-3 rounded-md border border-destructive/30 bg-destructive/10 text-destructive text-xs">
            Backend unreachable: {error}
          </div>
        )}

        {!rooms && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 size={14} className="animate-spin" /> Loading rooms…
          </div>
        )}

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {(rooms || []).map((r) => {
            const isSaved = saved.includes(Number(r.room_id));
            const roomStatus = (r.status || "available").toLowerCase() as StatusKey;
            const availableForDates = Number(r.available_for_dates) === 1 || r.available_for_dates === true;
            const hasAvailableBeds = Number(r.available_beds) > 0;
            const isMaintenance = roomStatus === "maintenance";
            const statusLabel = (() => {
              if (isMaintenance) return "Not Available";
              if (roomStatus === "reserving") return "Reserving";
              if (roomStatus === "reserved") return "Reserved";
              if (!hasDateRange) {
                if (roomStatus === "available") return "Available";
                if (roomStatus === "occupied") return "Occupied";
                return "Not Available";
              }
              if (availableForDates) return "Available";
              if (roomStatus === "occupied") return "Occupied";
              return "Not Available";
            })();
            const key: StatusKey = isMaintenance
              ? "maintenance"
              : roomStatus === "reserving" || roomStatus === "reserved"
                ? roomStatus
                : hasDateRange && availableForDates ? "available" : roomStatus;
            return (
              <div key={r.room_id} className="flex flex-col rounded-lg border border-border bg-card p-5 shadow-sm">
                <GuestRoomPhotoSlideshow
                  roomId={r.room_id}
                  roomNumber={r.room_number}
                  coverImage={r.image}
                />
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <BedDouble size={18} className="text-primary" />
                    <span className="font-display font-semibold">Room {r.room_number}</span>
                  </div>
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${statusBadge[key] || statusBadge.maintenance}`}>
                    {statusLabel}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mb-2">{r.room_type}</p>
                {Number(r.capacity) >= 2 && (
                  <p className="text-xs text-muted-foreground mb-2">
                    {Number(r.available_beds ?? Math.max(0, Number(r.capacity) - Number(r.occupants ?? 0)))} bedspace(s) available
                  </p>
                )}
                {r.description && (
                  <p className="text-xs text-muted-foreground mb-3 line-clamp-3">{r.description}</p>
                )}
                <div className="mt-auto pt-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-sm">{peso(Number(r.monthly_rent))}<span className="text-xs text-muted-foreground">/mo</span></span>
                    <button
                      type="button"
                      onClick={() => toggleSave(Number(r.room_id))}
                      className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-2 text-xs font-medium transition-colors ${isSaved ? "bg-destructive/10 text-destructive" : "text-muted-foreground hover:bg-muted"}`}
                      aria-label={isSaved ? "Remove room from saved" : "Save room"}
                      aria-pressed={isSaved}
                      title={isSaved ? "Remove from saved rooms" : "Save room"}
                    >
                      <Heart size={16} fill={isSaved ? "currentColor" : "none"} />
                      <span>{isSaved ? "Saved" : "Save room"}</span>
                    </button>
                  </div>
                  <Button
                    type="button"
                    className="w-full"
                    size="sm"
                    variant="outline"
                    onClick={() => setQuickViewRoom(r)}
                  >
                    <Maximize2 size={14} />
                    Quick view
                  </Button>
                  {!isMaintenance && (!hasDateRange ? hasAvailableBeds : availableForDates) ? (
                    <Button className="w-full" size="sm" disabled={acquiringHold} onClick={() => startBooking(r)}>
                      {acquiringHoldRoomId === r.room_id ? "Reserving..." : "Book Now"}
                    </Button>
                  ) : (
                    <Button className="w-full" size="sm" variant="outline" disabled>
                      {isMaintenance ? "Not Available" : invalidDateRange ? "Fix Dates to Check" : !hasDateRange ? "Select Dates" : "Not Available"}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <Dialog
          open={quickViewRoom !== null}
          onOpenChange={(open) => {
            if (!open) setQuickViewRoom(null);
          }}
        >
          {quickViewRoom && (() => {
            const roomStatus = (quickViewRoom.status || "available").toLowerCase() as StatusKey;
            const availableForDates = Number(quickViewRoom.available_for_dates) === 1 || quickViewRoom.available_for_dates === true;
            const hasAvailableBeds = Number(quickViewRoom.available_beds) > 0;
            const isMaintenance = roomStatus === "maintenance";
            const statusLabel = isMaintenance
              ? "Not Available"
              : roomStatus === "reserving" ? "Reserving"
                : roomStatus === "reserved" ? "Reserved"
              : !hasDateRange
                ? roomStatus === "available" ? "Available"
                  : roomStatus === "occupied" ? "Occupied"
                    : "Not Available"
                : availableForDates ? "Available"
                  : roomStatus === "occupied" ? "Occupied" : "Not Available";
            const statusKey: StatusKey = isMaintenance
              ? "maintenance"
              : roomStatus === "reserving" || roomStatus === "reserved"
                ? roomStatus
                : hasDateRange && availableForDates ? "available" : roomStatus;
            const isBookable = !isMaintenance
              && (hasDateRange ? availableForDates : hasAvailableBeds);
            const isSaved = saved.includes(Number(quickViewRoom.room_id));

            return (
              <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
                <DialogHeader className="pr-8">
                  <DialogTitle className="font-display text-xl">
                    Room {quickViewRoom.room_number}
                  </DialogTitle>
                  <DialogDescription>{quickViewRoom.room_type}</DialogDescription>
                </DialogHeader>
                <GuestRoomPhotoSlideshow
                  roomId={quickViewRoom.room_id}
                  roomNumber={quickViewRoom.room_number}
                  coverImage={quickViewRoom.image}
                  expanded
                />
                <div className="flex items-center justify-between gap-3">
                  <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${statusBadge[statusKey] || statusBadge.maintenance}`}>
                    {statusLabel}
                  </span>
                  <span className="text-lg font-semibold">
                    {peso(Number(quickViewRoom.monthly_rent))}
                    <span className="text-sm font-normal text-muted-foreground">/mo</span>
                  </span>
                </div>
                {Number(quickViewRoom.capacity) >= 2 && (
                  <p className="text-sm text-muted-foreground">
                    {Number(quickViewRoom.available_beds ?? Math.max(0, Number(quickViewRoom.capacity) - Number(quickViewRoom.occupants ?? 0)))} bedspace
                    {Number(quickViewRoom.available_beds ?? Number(quickViewRoom.capacity) - Number(quickViewRoom.occupants ?? 0)) === 1 ? "" : "s"} available
                  </p>
                )}
                {quickViewRoom.description && (
                  <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                    {quickViewRoom.description}
                  </p>
                )}
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <Button
                    type="button"
                    variant={isSaved ? "secondary" : "outline"}
                    onClick={() => toggleSave(Number(quickViewRoom.room_id))}
                  >
                    <Heart size={16} fill={isSaved ? "currentColor" : "none"} />
                    {isSaved ? "Saved" : "Save room"}
                  </Button>
                  <Button
                    type="button"
                    disabled={!isBookable || acquiringHold}
                    onClick={() => startBooking(quickViewRoom)}
                  >
                    {acquiringHoldRoomId === quickViewRoom.room_id ? "Reserving..." : isBookable ? "Book Now" : statusLabel}
                  </Button>
                </div>
              </DialogContent>
            );
          })()}
        </Dialog>
      </div>

      {/* Step 1: Terms */}
      <BookingTermsDialog
        open={termsOpen}
        onOpenChange={(open) => {
          if (open) setTermsOpen(true);
          else cancelBookingStart();
        }}
        roomName={bookingRoom ? `Room ${bookingRoom.room_number}` : undefined}
        onAccept={() => { setTermsOpen(false); setDetailsOpen(true); }}
      />

      {/* Steps 1-5: tenant details, dates, payment plan, review, confirmation */}
      <Dialog
        open={detailsOpen}
        onOpenChange={(open) => {
          if (!open && submitting) return;
          setDetailsOpen(open);
          if (!open) {
            setBookingRoom(null);
            void releaseRoomHold();
          }
        }}
      >
        <DialogContent
          className="max-w-md max-h-[85vh] overflow-y-auto"
          onInteractOutside={event => event.preventDefault()}
          onEscapeKeyDown={event => event.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle className="font-display text-xl">Booking Details</DialogTitle>
            <DialogDescription className="text-xs">
              {bookingRoom ? `Room ${bookingRoom.room_number} — ${peso(Number(bookingRoom.monthly_rent))}/mo` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
              {step === 1 && <>
              <div>
              <Label className="text-xs">Full Name</Label>
              <Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Email</Label>
              <Input type="email" value={form.email} readOnly />
            </div>
            <div>
              <Label className="text-xs">Phone</Label>
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="09XXXXXXXXX" />
            </div>
            {!boundaryDatesReady && (
              <div className="flex items-center justify-between gap-3 rounded-md border border-warning/40 bg-warning/10 p-3 text-xs">
                <span role={scheduledRoomDatesError ? "alert" : "status"}>
                  {scheduledRoomDatesError
                    ? "Scheduled room dates could not be loaded. Please retry before choosing dates."
                    : loadingScheduledRoomDates
                      ? "Checking scheduled room dates..."
                      : "Waiting for scheduled room dates..."}
                </span>
                {scheduledRoomDatesError && (
                  <Button type="button" size="sm" variant="outline" onClick={() => void refetchScheduledRoomDates()}>
                    Retry
                  </Button>
                )}
              </div>
            )}
            <div>
              <Label className="text-xs">Check-in Date</Label>
              <Popover open={checkInCalendarOpen} onOpenChange={setCheckInCalendarOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full justify-start text-left font-normal"
                    disabled={!boundaryDatesReady}
                  >
                    <CalendarDays className="mr-2 h-4 w-4" />
                    {form.move_in_date
                      ? format(new Date(`${form.move_in_date}T00:00:00`), "PPP")
                      : "Select move-in date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={form.move_in_date ? new Date(`${form.move_in_date}T00:00:00`) : undefined}
                    disabled={[
                      { before: new Date(`${minimumCheckInDate}T00:00:00`) },
                      ...unavailableCalendarDates,
                    ]}
                    onSelect={(date) => {
                      const moveInDate = date ? format(date, "yyyy-MM-dd") : "";
                      const nextMinimumCheckOutDate = moveInDate
                        ? format(addMonths(new Date(`${moveInDate}T00:00:00`), 1), "yyyy-MM-dd")
                        : "";
                      setForm({
                        ...form,
                        move_in_date: moveInDate,
                        check_out_date: moveInDate && form.check_out_date >= nextMinimumCheckOutDate
                          ? form.check_out_date
                          : "",
                      });
                      setCheckInCalendarOpen(false);
                    }}
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div>
              <Label className="text-xs">Check-out / Move-out Date</Label>
              <Popover open={checkOutCalendarOpen} onOpenChange={setCheckOutCalendarOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full justify-start text-left font-normal"
                    disabled={!boundaryDatesReady || !form.move_in_date}
                  >
                    <CalendarDays className="mr-2 h-4 w-4" />
                    {form.check_out_date
                      ? format(new Date(`${form.check_out_date}T00:00:00`), "PPP")
                      : "Select move-out date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={form.check_out_date ? new Date(`${form.check_out_date}T00:00:00`) : undefined}
                    disabled={[
                      ...(minimumCheckOutDate
                        ? [{ before: new Date(`${minimumCheckOutDate}T00:00:00`) }]
                        : []),
                      ...unavailableCalendarDates,
                    ]}
                    onSelect={(date) => {
                      setForm({
                        ...form,
                        check_out_date: date ? format(date, "yyyy-MM-dd") : "",
                      });
                      setCheckOutCalendarOpen(false);
                    }}
                  />
                </PopoverContent>
              </Popover>
            </div>
            <Button className="w-full mt-2" disabled={!form.full_name || !form.email || !form.phone || !datesValid || acquiringHold} onClick={continueToPaymentPlan}>
              {acquiringHold ? "Securing room..." : "Continue to Payment Plan"}
            </Button>
            </>}
            {step === 2 && <>
              <div className="rounded-md bg-muted/50 p-3 text-sm"><p>Length of stay: <strong>{stayMonths} month{stayMonths === 1 ? "" : "s"}</strong></p><p>Estimated total: <strong>{peso(totalRent)}</strong></p></div>
              <div className="space-y-2"><Label className="text-xs">Payment Plan</Label>
                <select className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm" value={form.payment_plan} onChange={(e) => setForm({ ...form, payment_plan: e.target.value })}>
                  <option>Pay Monthly</option>
                  <option value="Pay One Month Rent">Pay One Month Rent (Deposit at Move-in)</option>
                </select>
              </div>
              <Button className="w-full" onClick={() => setStep(3)}>Review Booking</Button>
            </>}
            {step === 3 && <>
              <div className="grid gap-2 text-sm rounded-md border border-border p-3">
                <p><strong>Room:</strong> {bookingRoom?.room_number} ({bookingRoom?.room_type})</p><p><strong>Dates:</strong> {form.move_in_date} to {form.check_out_date}</p><p><strong>Length:</strong> {stayMonths} month{stayMonths === 1 ? "" : "s"}</p><p><strong>Monthly rent:</strong> {peso(Number(bookingRoom?.monthly_rent || 0))}</p><p><strong>Total rent:</strong> {peso(totalRent)}</p><p><strong>Plan:</strong> {form.payment_plan}</p>
              </div>
              <p className="text-xs text-muted-foreground">
                {form.payment_plan === "Pay One Month Rent"
                  ? "Pay one month of rent now. The one-month security deposit is due when you move in."
                  : "The one-month advance covers the first month, and the security deposit covers the final month of rent."}
              </p>
              <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs space-y-1">
                <p className="font-semibold text-foreground">Payment required today: {peso(initialPayment)}</p>
                {form.payment_plan === "Pay One Month Rent" ? (
                  <p className="text-muted-foreground">One-month security deposit due at move-in: {peso(securityDeposit)}</p>
                ) : (
                  <p className="text-muted-foreground">One-month security deposit: {peso(securityDeposit)}</p>
                )}
                <p className="text-muted-foreground">One-month advance rent: {peso(advanceRent)}</p>
                <p className="font-medium text-foreground">Remaining rent: {peso(remainingRent)}</p>
              </div>
              <Button className="w-full" disabled={submitting} onClick={submitBooking}>{submitting ? "Submitting..." : "Confirm Booking"}</Button>
            </>}
          </div>
        </DialogContent>
      </Dialog>

      <BookingPaymentDialog
        open={paymentOpen}
        onOpenChange={(open) => {
          setPaymentOpen(open);
          if (!open) {
            setSubmittedBookingId(null);
            setPaymentAmount(0);
            setPaymentDeadline(null);
            paymentSubmissionKey.current = null;
            paymentSubmittedRef.current = false;
          }
        }}
        preventOutsideClose
        onBeforeClose={async () => {
          if (!submittedBookingId || paymentSubmittedRef.current) return true;
          try {
            await cancelMyGuestBooking(submittedBookingId);
            toast({
              title: "Booking cancelled",
              description: "Your reservation was cancelled before payment was submitted.",
            });
            refetchRooms();
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
        roomName={submittedBookingId ? `Booking #${submittedBookingId}` : "your booking"}
        amount={paymentAmount ? peso(paymentAmount) : undefined}
        amountPHP={paymentAmount}
        bookingId={submittedBookingId ?? undefined}
        paymentExpiresAtEpoch={paymentDeadline?.expiresAtEpoch}
        serverNowEpoch={paymentDeadline?.serverNowEpoch}
        allowScreenshot
        requireReference
        allowedMethods={["gcash"]}
        title="Initial Booking Payment"
        description="Your room is temporarily reserved. Complete payment before the deadline. Closing this window before payment is submitted cancels the booking; after submission, it remains awaiting administrator review."
        successTitle="Booking Payment Submitted"
        successDescription="Your payment has been successfully submitted! Your reservation is now awaiting administrator verification. Please allow 30–60 minutes for the administrator to verify your payment. You will receive an update once your payment has been reviewed. Your reservation is not yet confirmed."
        onPaid={async (method, reference, _captureId, _orderId, screenshot) => {
          if (!submittedBookingId) throw new Error("Booking reference is missing.");
          paymentSubmissionKey.current ||= crypto.randomUUID();
          await submitMyBookingInitialPayment(
            submittedBookingId,
            method,
            reference,
            screenshot,
            paymentSubmissionKey.current,
          );
          paymentSubmittedRef.current = true;
          paymentSubmissionKey.current = null;
          toast({ title: "GCash payment submitted for admin review" });
          refetchRooms();
        }}
      />
    </DashboardLayout>
  );
};

export default GuestRooms;
