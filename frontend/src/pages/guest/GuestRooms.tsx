import { DashboardLayout } from "@/components/DashboardLayout";
import { GuestRoomPhotoSlideshow } from "@/components/GuestRoomPhotoSlideshow";
import { RoomOccupantGender } from "@/components/RoomOccupantGender";
import { RoomReservationSummary } from "@/components/RoomReservationSummary";
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
import { RoomFilters } from "@/components/RoomFilters";
import { BookingTermsDialog } from "@/components/BookingTermsDialog";
import { BookingPaymentDialog } from "@/components/BookingPaymentDialog";
import { toast } from "@/hooks/use-toast";
import { readSavedRoomIds, writeSavedRoomIds } from "@/lib/savedRooms";
import { format } from "date-fns";
import { calculateMoveOutDate } from "@/lib/stayDates";
import { getCurrentPhilippineDate, getPublicRoomsForDates, type PublicRoom } from "@/lib/publicRooms";
import { formatRoomFloor } from "@/lib/roomFloor";
import {
  emptyRoomFilters,
  filterRooms,
  getRoomFilterOptions,
  type RoomFilters as RoomFilterValues,
} from "@/lib/roomFilters";
import {
  acquireMyGuestRoomHold,
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

const noPublicRooms: PublicRoom[] = [];

const GuestRooms = () => {
  const session = sessionStore.get();
  const minimumCheckInDate = getCurrentPhilippineDate();
  const [saved, setSaved] = useState<number[]>([]);
  const [quickViewRoom, setQuickViewRoom] = useState<PublicRoom | null>(null);
  const [roomFilters, setRoomFilters] = useState<RoomFilterValues>({ ...emptyRoomFilters });

  // Booking flow state
  const [bookingRoom, setBookingRoom] = useState<PublicRoom | null>(null);
  const [termsOpen, setTermsOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [checkInCalendarOpen, setCheckInCalendarOpen] = useState(false);
  const [stayMonthsInput, setStayMonthsInput] = useState("1");
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
  const bookingFlowRevision = useRef(0);
  const [form, setForm] = useState({
    full_name: session?.full_name || session?.username || "",
    email: session?.email || "",
    phone: session?.phone || "",
    move_in_date: "",
    check_out_date: "",
    payment_plan: "Pay One Month Rent",
    notes: "",
  });
  const stayMonths = /^\d+$/.test(stayMonthsInput) ? Number(stayMonthsInput) : 0;
  const paymentPlan = stayMonths < 2 && form.payment_plan === "Pay Monthly"
    ? "Pay One Month Rent"
    : form.payment_plan;
  const paymentPlanLabel = paymentPlan === "Pay Monthly"
    ? "Pay 1 month and 1 deposit"
    : "Pay 1 month";
  const minimumCheckOutDate = calculateMoveOutDate(form.move_in_date, 1);
  const calculatedCheckOutDate = calculateMoveOutDate(form.move_in_date, stayMonths);
  const hasAnyDates = Boolean(form.move_in_date || stayMonthsInput !== "1");
  const hasDateRange = Boolean(form.move_in_date && calculatedCheckOutDate
    && calculatedCheckOutDate >= minimumCheckOutDate
    && form.move_in_date >= minimumCheckInDate);
  const invalidDateRange = hasAnyDates && !hasDateRange;
  const roomCheckInDate = hasDateRange ? form.move_in_date : minimumCheckInDate;
  const defaultCheckOutDate = new Date(`${minimumCheckInDate}T00:00:00`);
  defaultCheckOutDate.setDate(defaultCheckOutDate.getDate() + 1);
  const roomCheckOutDate = hasDateRange ? calculatedCheckOutDate : format(defaultCheckOutDate, "yyyy-MM-dd");
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
  } = useSupabasePolling<RoomBoundaryDates>(loadBoundaryDates, 5000, Boolean(boundaryRoomId));
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
  const monthlyRentPerPerson = Number(bookingRoom?.monthly_rent ?? 0);
  const availableRooms = rooms ?? noPublicRooms;
  const filteredRooms = useMemo(
    () => filterRooms(availableRooms, roomFilters),
    [availableRooms, roomFilters],
  );
  const roomFilterOptions = useMemo(() => getRoomFilterOptions(availableRooms), [availableRooms]);

  useEffect(() => {
    setSaved(readSavedRoomIds());
  }, []);

  useEffect(() => {
    const currentRoomId = bookingRoom?.room_id;
    if (!currentRoomId || scheduledRoomDates?.room_id !== currentRoomId) return;
    setForm((current) => {
      const moveInDate = unavailableDateSet.has(current.move_in_date) ? "" : current.move_in_date;
      const checkOutDate = moveInDate
        ? calculateMoveOutDate(moveInDate, stayMonths)
        : "";
      if (moveInDate === current.move_in_date && checkOutDate === current.check_out_date) return current;
      return {
        ...current,
        move_in_date: moveInDate,
        check_out_date: moveInDate ? checkOutDate : "",
      };
    });
  }, [bookingRoom?.room_id, scheduledRoomDates?.room_id, stayMonths, unavailableDateSet]);

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
    bookingFlowRevision.current += 1;
    setTermsOpen(false);
    setDetailsOpen(false);
    setBookingRoom(null);
    setStep(1);
    bookingRequestKey.current = null;
    if (!acquiringHold) void releaseRoomHold();
  };

  const startBooking = async (room: PublicRoom) => {
    if (acquiringHold) return;
    if (room.has_active_booking) {
      toast({
        title: "Room already in My Bookings",
        description: "You already have an active booking for this room. Check My Booking for its current status.",
        variant: "destructive",
      });
      return;
    }
    const flowRevision = ++bookingFlowRevision.current;
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
      if (bookingFlowRevision.current !== flowRevision) {
        await releaseRoomHold();
        return;
      }
      setQuickViewRoom(null);
      setBookingRoom(room);
      setForm(current => ({ ...current, payment_plan: "Pay One Month Rent" }));
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
      if (bookingFlowRevision.current !== flowRevision) {
        await releaseRoomHold();
        return;
      }
      const message = error instanceof Error ? error.message : "Please try again.";
      if (message.includes("already have an active booking for this room")) {
        toast({
          title: "Room already in My Bookings",
          description: "You already have an active booking for this room. Check My Booking for its current status.",
          variant: "destructive",
        });
        refetchRooms();
        return;
      }
      toast({
        title: "Unable to reserve room",
        description: message,
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
    const flowRevision = bookingFlowRevision.current;
    setAcquiringHold(true);
    try {
      await acquireMyGuestRoomHold({
        room_id: bookingRoom.room_id,
        move_in_date: form.move_in_date,
        check_out_date: form.check_out_date,
      });
      if (bookingFlowRevision.current !== flowRevision) {
        await releaseRoomHold();
        return;
      }
      setStep(2);
      refetchRooms();
    } catch (error: unknown) {
      if (bookingFlowRevision.current !== flowRevision) {
        await releaseRoomHold();
        return;
      }
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
        payment_plan: paymentPlan,
        room_id: bookingRoom.room_id,
        idempotency_key: bookingRequestKey.current,
      });
      toast({
        title: "Room temporarily reserved",
        description: "Your room is reserved for 30 minutes while you complete the initial payment. After you submit payment proof for review, the reservation lasts 24 hours.",
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

  const totalRent = monthlyRentPerPerson * stayMonths;
  const securityDeposit = monthlyRentPerPerson;
  const advanceRent = monthlyRentPerPerson;
  const initialPayment = paymentPlan === "Pay Monthly"
    ? securityDeposit + advanceRent
    : advanceRent;
  const remainingRent = Math.max(0, totalRent - advanceRent);
  const datesValid = Boolean(
    form.move_in_date >= minimumCheckInDate
    && calculatedCheckOutDate === form.check_out_date
    && calculatedCheckOutDate >= minimumCheckOutDate
    && boundaryDatesReady
    && !unavailableDateSet.has(form.move_in_date)
    && !unavailableDateSet.has(form.check_out_date),
  );

  return (
    <DashboardLayout
      role="guest"
      roomAvailabilityRange={{ checkInDate: roomCheckInDate, checkOutDate: roomCheckOutDate }}
    >
      <div className="space-y-6">
        <div>
          <h1 className="font-display text-2xl font-bold">Browse Rooms</h1>
          <p className="text-muted-foreground text-sm mt-1">Choose your stay dates to check room availability before booking.</p>
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

        <RoomFilters
          filters={roomFilters}
          floors={roomFilterOptions.floors}
          capacities={roomFilterOptions.capacities}
          resultCount={filteredRooms.length}
          totalCount={availableRooms.length}
          onChange={setRoomFilters}
        />

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredRooms.map((r) => {
            const isSaved = saved.includes(Number(r.room_id));
            const roomStatus = (r.status || "available").toLowerCase() as StatusKey;
            const availableForDates = Number(r.available_for_dates) === 1 || r.available_for_dates === true;
            const hasAvailableBeds = Number(r.available_beds) > 0;
            const isMaintenance = roomStatus === "maintenance";
            const hasActiveBooking = r.has_active_booking === true;
            const statusLabel = r.status || "Unknown";
            const key = roomStatus;
            return (
              <div key={r.room_id} className="flex min-w-0 flex-col rounded-lg border border-border bg-card p-4 shadow-sm sm:p-5">
                <GuestRoomPhotoSlideshow
                  roomId={r.room_id}
                  roomNumber={r.room_number}
                  coverImage={r.image}
                />
                <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <BedDouble size={18} className="text-primary" />
                    <span className="font-display text-lg font-bold">Room {r.room_number}</span>
                  </div>
                  <span className={`rounded-full border px-2.5 py-1 text-xs font-bold uppercase tracking-wide ${statusBadge[key] || statusBadge.maintenance}`}>
                    {statusLabel}
                  </span>
                </div>
                <p className="mb-2 text-sm font-medium text-foreground/80">{formatRoomFloor(r.floor_number)}</p>
                <RoomOccupantGender genders={r.occupant_genders} className="mb-2" />
                <RoomReservationSummary
                  deadlines={r.reservation_deadlines_epoch}
                  serverNowEpoch={r.reservation_server_now_epoch}
                  className="mb-2"
                />
                <p className="mb-2 text-sm font-semibold text-foreground">
                  {Number(r.available_beds ?? Math.max(0, Number(r.capacity) - Number(r.occupants ?? 0)))} bedspace
                  {Number(r.available_beds ?? Math.max(0, Number(r.capacity) - Number(r.occupants ?? 0))) === 1 ? "" : "s"} available
                </p>
                {r.description && (
                  <p className="mb-3 line-clamp-3 text-sm leading-relaxed text-muted-foreground">{r.description}</p>
                )}
                <div className="mt-auto pt-3 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-display text-base font-bold">{peso(Number(r.monthly_rent))}<span className="ml-1 font-sans text-sm font-normal text-muted-foreground">/person/mo</span></span>
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
                  {hasActiveBooking ? (
                    <Button className="w-full" size="sm" variant="outline" disabled>
                      Already in My Bookings
                    </Button>
                  ) : !isMaintenance && (!hasDateRange ? hasAvailableBeds : availableForDates) ? (
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
        {rooms && filteredRooms.length === 0 && (
          <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            {availableRooms.length === 0
              ? "No rooms are currently available to browse."
              : "No rooms match your selected filters."}
          </div>
        )}

        <Dialog
          open={quickViewRoom !== null}
          onOpenChange={(open) => {
            if (!open) {
              setQuickViewRoom(null);
              if (acquiringHold && acquiringHoldRoomId !== null) {
                bookingFlowRevision.current += 1;
              }
            }
          }}
        >
          {quickViewRoom && (() => {
            const roomStatus = (quickViewRoom.status || "available").toLowerCase() as StatusKey;
            const availableForDates = Number(quickViewRoom.available_for_dates) === 1 || quickViewRoom.available_for_dates === true;
            const hasAvailableBeds = Number(quickViewRoom.available_beds) > 0;
            const isMaintenance = roomStatus === "maintenance";
            const hasActiveBooking = quickViewRoom.has_active_booking === true;
            const statusLabel = quickViewRoom.status || "Unknown";
            const statusKey = roomStatus;
            const isBookable = !isMaintenance
              && !hasActiveBooking
              && (hasDateRange ? availableForDates : hasAvailableBeds);
            const isSaved = saved.includes(Number(quickViewRoom.room_id));

            return (
              <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
                <DialogHeader className="pr-8">
                  <DialogTitle className="font-display text-xl">
                    Room {quickViewRoom.room_number}
                  </DialogTitle>
                  <DialogDescription>{formatRoomFloor(quickViewRoom.floor_number)}</DialogDescription>
                </DialogHeader>
                <GuestRoomPhotoSlideshow
                  roomId={quickViewRoom.room_id}
                  roomNumber={quickViewRoom.room_number}
                  coverImage={quickViewRoom.image}
                  expanded
                />
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${statusBadge[statusKey] || statusBadge.maintenance}`}>
                    {statusLabel}
                  </span>
                  <span className="text-lg font-semibold">
                    {peso(Number(quickViewRoom.monthly_rent))}
                    <span className="text-sm font-normal text-muted-foreground">/person/mo</span>
                  </span>
                </div>
                <RoomOccupantGender genders={quickViewRoom.occupant_genders} className="mt-3" />
                <RoomReservationSummary
                  deadlines={quickViewRoom.reservation_deadlines_epoch}
                  serverNowEpoch={quickViewRoom.reservation_server_now_epoch}
                  className="mt-3"
                />
                <p className="text-sm text-muted-foreground">
                  {Number(quickViewRoom.available_beds ?? Math.max(0, Number(quickViewRoom.capacity) - Number(quickViewRoom.occupants ?? 0)))} bedspace
                  {Number(quickViewRoom.available_beds ?? Number(quickViewRoom.capacity) - Number(quickViewRoom.occupants ?? 0)) === 1 ? "" : "s"} available
                </p>
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
                    {acquiringHoldRoomId === quickViewRoom.room_id
                      ? "Reserving..."
                      : hasActiveBooking ? "Already in My Bookings" : isBookable ? "Book Now" : statusLabel}
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
          if (open) setDetailsOpen(true);
          else cancelBookingStart();
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
              {bookingRoom ? `Room ${bookingRoom.room_number} — ${peso(Number(bookingRoom.monthly_rent))}/person/month` : ""}
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
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-warning/40 bg-warning/10 p-3 text-xs">
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
                      if (moveInDate && unavailableDateSet.has(moveInDate)) {
                        toast({
                          title: "Check-in date unavailable",
                          description: "Another tenant or pending booking already selected this date.",
                          variant: "destructive",
                        });
                        return;
                      }
                      setForm({
                        ...form,
                        move_in_date: moveInDate,
                        check_out_date: calculateMoveOutDate(moveInDate, stayMonths),
                      });
                      setCheckInCalendarOpen(false);
                    }}
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div>
              <Label htmlFor="guest-stay-months" className="text-xs">Length of Stay (months)</Label>
              <Input
                id="guest-stay-months"
                type="number"
                min="1"
                step="1"
                required
                value={stayMonthsInput}
                onChange={event => {
                  const months = event.target.value;
                  setStayMonthsInput(months);
                  setForm(current => ({
                    ...current,
                    check_out_date: calculateMoveOutDate(
                      current.move_in_date,
                      /^\d+$/.test(months) ? Number(months) : 0,
                    ),
                  }));
                }}
              />
            </div>
            <div>
              <Label htmlFor="guest-calculated-move-out" className="text-xs">Move-out Date (calculated)</Label>
              <Input
                id="guest-calculated-move-out"
                readOnly
                value={form.check_out_date
                  ? format(new Date(`${form.check_out_date}T00:00:00`), "PPP")
                  : ""}
                placeholder="Select move-in date and stay length"
              />
              {form.check_out_date && unavailableDateSet.has(form.check_out_date) && (
                <p className="mt-1 text-xs text-destructive">
                  The calculated move-out date conflicts with an unavailable date. Change your move-in date or stay length.
                </p>
              )}
            </div>
            <Button className="w-full mt-2" disabled={!form.full_name || !form.email || !form.phone || !datesValid || acquiringHold} onClick={continueToPaymentPlan}>
              {acquiringHold ? "Securing room..." : "Continue to Payment Plan"}
            </Button>
            </>}
            {step === 2 && <>
              <div className="rounded-md bg-muted/50 p-3 text-sm">
                <p>Length of stay: <strong>{stayMonths} month{stayMonths === 1 ? "" : "s"}</strong></p>
                <p>Estimated rent for 1 person: <strong>{peso(totalRent)}</strong></p>
                <p>Payment required today: <strong>{peso(initialPayment)}</strong></p>
                <p>
                  Security deposit {paymentPlan === "Pay One Month Rent" ? "due at move-in" : "included today"}:
                  {" "}{peso(securityDeposit)}
                </p>
                <p>Remaining rent after first month: <strong>{peso(remainingRent)}</strong></p>
              </div>
              <div className="space-y-2"><Label className="text-xs">Payment Plan</Label>
                <select className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm" value={paymentPlan} onChange={(e) => setForm(current => ({ ...current, payment_plan: e.target.value }))}>
                  <option value="Pay One Month Rent">Pay 1 month</option>
                  {stayMonths >= 2 && <option value="Pay Monthly">Pay 1 month and 1 deposit</option>}
                </select>
              </div>
              <Button className="w-full" onClick={() => setStep(3)}>Review Booking</Button>
            </>}
            {step === 3 && <>
              <div className="grid gap-2 text-sm rounded-md border border-border p-3">
                <p><strong>Room:</strong> {bookingRoom?.room_number} ({formatRoomFloor(bookingRoom?.floor_number)})</p><p><strong>Dates:</strong> {form.move_in_date} to {form.check_out_date}</p><p><strong>Length:</strong> {stayMonths} month{stayMonths === 1 ? "" : "s"}</p><p><strong>Monthly rent per person:</strong> {peso(monthlyRentPerPerson)}</p><p><strong>Total rent for 1 person:</strong> {peso(totalRent)}</p><p><strong>Plan:</strong> {paymentPlanLabel}</p>
              </div>
              <p className="text-xs text-muted-foreground">
                {paymentPlan === "Pay One Month Rent"
                  ? "Pay one month of rent now. The one-month security deposit is due when you move in."
                  : "Pay one month of rent and one security deposit now. The deposit is separate from the rent for your stay."}
              </p>
              <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs space-y-1">
                <p className="font-semibold text-foreground">Payment required today: {peso(initialPayment)}</p>
                {paymentPlan === "Pay One Month Rent" ? (
                  <p className="text-muted-foreground">One-month security deposit due at move-in: {peso(securityDeposit)}</p>
                ) : (
                  <p className="text-muted-foreground">One-month security deposit (included today): {peso(securityDeposit)}</p>
                )}
                <p className="text-muted-foreground">One-month advance rent: {peso(advanceRent)}</p>
                <p className="font-medium text-foreground">Remaining rent for {Math.max(0, stayMonths - 1)} month{stayMonths === 2 ? "" : "s"}: {peso(remainingRent)}</p>
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
          }
        }}
        preventOutsideClose
        roomName={submittedBookingId ? `Booking #${submittedBookingId}` : "your booking"}
        amount={paymentAmount ? peso(paymentAmount) : undefined}
        amountPHP={paymentAmount}
        bookingId={submittedBookingId ?? undefined}
        paymentExpiresAtEpoch={paymentDeadline?.expiresAtEpoch}
        serverNowEpoch={paymentDeadline?.serverNowEpoch}
        allowScreenshot
        requireReference
        requireScreenshot
        allowedMethods={["gcash"]}
        title="Initial Booking Payment"
        description="Submit your payment proof within 30 minutes of booking. After you click “I've paid — submit for review,” the reservation remains active for 24 hours while an administrator reviews your payment. Closing this window does not cancel the saved booking."
        successTitle="Booking Payment Submitted"
        successDescription="Your payment proof is awaiting administrator verification. The reservation remains active for 24 hours from payment submission. You will receive an update once your payment has been reviewed."
        onPaid={async (method, reference, _captureId, _orderId, screenshot) => {
          if (!submittedBookingId) throw new Error("Booking reference is missing.");
          paymentSubmissionKey.current ||= crypto.randomUUID();
          const submissionResult = await submitMyBookingInitialPayment(
            submittedBookingId,
            method,
            reference,
            screenshot,
            paymentSubmissionKey.current,
          );
          paymentSubmissionKey.current = null;
          setPaymentDeadline(submissionResult.reservationDeadline
            ? {
                expiresAtEpoch: submissionResult.reservationDeadline.payment_expires_at_epoch,
                serverNowEpoch: submissionResult.reservationDeadline.server_now_epoch,
              }
            : null);
          const warnings = [
            submissionResult.reservationDeadlineError
              ? "Payment was submitted, but the updated reservation deadline could not be loaded. Reopen My Booking to refresh it."
              : null,
            submissionResult.status === "partial"
              ? "Some administrators could not be notified by SMS."
              : submissionResult.status === "in_progress"
                ? "The administrator SMS notification is still being processed."
                : submissionResult.status !== "sent"
                  ? "An administrator could not be notified by SMS. Please contact the boarding house if needed."
                  : null,
          ].filter((warning): warning is string => warning !== null);
          toast({
            title: "GCash payment submitted for admin review",
            ...(warnings.length ? { description: warnings.join(" ") } : {}),
          });
          refetchRooms();
        }}
      />
    </DashboardLayout>
  );
};

export default GuestRooms;
