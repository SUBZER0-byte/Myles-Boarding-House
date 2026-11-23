import { supabase } from "@/lib/supabase";
import { isSupabaseStorageImagePath } from "@/lib/storagePaths";
import { getPublicRooms } from "@/lib/publicRooms";

const proofBucket = "mbh-booking-payment-proofs";

export interface GuestBooking {
  booking_id: number;
  full_name: string;
  email: string;
  phone: string | null;
  gender: string | null;
  room_id: number | null;
  room_number: string | null;
  floor_number: number | null;
  room_status: string | null;
  reservation_type: "capacity_based" | "entire_room";
  occupant_count: number;
  move_in_date: string;
  check_out_date: string | null;
  length_of_stay_months: number;
  monthly_rent: number;
  payment_plan: string;
  total_rent: number;
  initial_payment_amount: number;
  initial_payment_status: string | null;
  initial_payment_paid: number;
  payment_expires_at_epoch: number | null;
  server_now_epoch: number;
  amount_paid: number;
  amount_due: number;
  next_payment_due: string | null;
  notes: string | null;
  status: string;
  created_at: string;
}

export interface AdminGuestBooking {
  booking_id: number;
  full_name: string;
  email: string;
  phone: string | null;
  gender: string | null;
  room_id: number | null;
  room_number: string | null;
  reservation_type: "capacity_based" | "entire_room";
  occupant_count: number;
  monthly_rent: number | null;
  move_in_date: string | null;
  check_out_date: string | null;
  payment_plan: string;
  total_rent: number;
  amount_paid: number;
  next_payment_due: string | null;
  status: string;
  notes: string | null;
  created_at: string;
  gcash_submitted_reference: string | null;
  gcash_submitted_screenshot: string | null;
  initial_payment_status: string | null;
  proof_unavailable?: boolean;
}

interface RpcResult<T> {
  type: "success";
  message?: string;
  data?: T;
}

export interface BookingSmsNotificationResult {
  status: "sent" | "partial" | "failed" | "in_progress";
  sent: number;
  failed: number;
  message?: string;
}

export interface BookingPaymentSubmissionResult extends BookingSmsNotificationResult {
  reservationDeadline: {
    payment_expires_at_epoch: number;
    server_now_epoch: number;
  } | null;
  reservationDeadlineError: string | null;
}

type BookingSmsAction = "payment_submitted" | "booking_confirmed" | "booking_rejected";

async function call<T>(action: string, data: Record<string, unknown> = {}): Promise<T> {
  const { data: response, error } = await supabase.rpc("manage_guest_booking", {
    p_action: action,
    p_data: data,
  });
  if (error) throw new Error(error.message || "Could not process the booking request.");
  if (!response || typeof response !== "object" || Array.isArray(response) || response.type !== "success") {
    throw new Error("The booking service returned an invalid response.");
  }
  const result = response as RpcResult<T>;
  return result.data as T;
}

async function notifyBookingSms(
  action: BookingSmsAction,
  bookingId: number,
): Promise<BookingSmsNotificationResult> {
  try {
    const { data, error } = await supabase.functions.invoke<BookingSmsNotificationResult>(
      "booking-sms-notifications",
      { body: { action, booking_id: bookingId } },
    );
    if (error) throw new Error(error.message || "Could not send booking SMS notifications.");
    if (
      !data
      || !["sent", "partial", "failed", "in_progress"].includes(data.status)
      || !Number.isSafeInteger(data.sent)
      || data.sent < 0
      || !Number.isSafeInteger(data.failed)
      || data.failed < 0
    ) {
      throw new Error("The booking SMS service returned an invalid response.");
    }
    return data;
  } catch (error) {
    console.error("Booking SMS notification failed:", error);
    return {
      status: "failed",
      sent: 0,
      failed: 1,
      message: error instanceof Error ? error.message : "Could not send booking SMS notifications.",
    };
  }
}

function requireId(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`A valid ${label} is required.`);
}

async function loadMyGuestBookingReservationDeadline(bookingId: number) {
  const { data, error } = await supabase.rpc("get_guest_booking_reservation_deadline", {
    p_booking_id: bookingId,
  });
  if (error) throw new Error(error.message || "Could not load the reservation deadline.");
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("The booking service returned an invalid reservation deadline.");
  }
  const deadline = data as Record<string, unknown>;
  if (
    typeof deadline.payment_expires_at_epoch !== "number"
    || !Number.isSafeInteger(deadline.payment_expires_at_epoch)
    || deadline.payment_expires_at_epoch <= 0
    || typeof deadline.server_now_epoch !== "number"
    || !Number.isSafeInteger(deadline.server_now_epoch)
    || deadline.server_now_epoch <= 0
  ) {
    throw new Error("The booking service returned an invalid reservation deadline.");
  }
  return {
    payment_expires_at_epoch: deadline.payment_expires_at_epoch,
    server_now_epoch: deadline.server_now_epoch,
  };
}

export function listMyGuestBookings() {
  return call<GuestBooking[]>("guest_list").then(async (bookings) => {
    if (!Array.isArray(bookings)) throw new Error("The booking service returned an invalid list.");
    const rooms = await getPublicRooms();
    const floorsByRoomId = new Map(rooms.map((room) => [room.room_id, room.floor_number]));
    return bookings.map((booking) => ({
      ...booking,
      floor_number: booking.room_id === null ? null : floorsByRoomId.get(booking.room_id) ?? null,
    }));
  });
}

export function acquireMyGuestRoomHold(input: {
  room_id: number;
  move_in_date?: string;
  check_out_date?: string;
}) {
  requireId(input.room_id, "room");
  return call<{ expires_at: string }>("acquire_hold", input);
}

export function releaseMyGuestRoomHold() {
  return call<null>("release_hold");
}

export async function createMyGuestBooking(input: {
  room_id: number;
  full_name: string;
  phone: string;
  move_in_date: string;
  check_out_date: string;
  payment_plan: string;
  notes: string;
  idempotency_key: string;
}) {
  requireId(input.room_id, "room");
  const booking = await call<{
    booking_id: number;
    initial_payment_amount: number;
    payment_expires_at_epoch: number;
    server_now_epoch: number;
  }>("create", input);
  if (!booking || !Number.isSafeInteger(booking.booking_id) || booking.booking_id <= 0) {
    throw new Error("The booking service returned an invalid booking identifier.");
  }

  const deadline = await loadMyGuestBookingReservationDeadline(booking.booking_id);
  return {
    ...booking,
    ...deadline,
  };
}

export async function submitMyBookingInitialPayment(
  bookingId: number,
  method: string,
  reference: string,
  screenshot: File | undefined,
  submissionKey: string,
) {
  requireId(bookingId, "booking");
  const cleanReference = reference.trim();
  if (!cleanReference) throw new Error("Enter the GCash transaction reference.");
  if (!screenshot) throw new Error("Upload the GCash payment screenshot.");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(submissionKey)) {
    throw new Error("A valid payment submission identifier is required.");
  }
  if (!["image/jpeg", "image/png", "image/webp"].includes(screenshot.type)
    || screenshot.size <= 0
    || screenshot.size > 5 * 1024 * 1024) {
    throw new Error("Payment proof must be a JPG, PNG, or WEBP image up to 5 MB.");
  }
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) throw new Error(authError.message || "Could not verify your account.");
  if (!authData.user) throw new Error("Sign in to submit a booking payment.");
  const extension = screenshot.type === "image/png" ? "png" : screenshot.type === "image/webp" ? "webp" : "jpg";
  const screenshotPath = `${authData.user.id}/${bookingId}/${submissionKey}.${extension}`;
  const { error: uploadError } = await supabase.storage
    .from(proofBucket)
    .upload(screenshotPath, screenshot, { contentType: screenshot.type, upsert: false });
  if (uploadError && !/already exists|duplicate/i.test(uploadError.message)) {
    throw new Error(uploadError.message || "Could not upload the payment proof.");
  }
  await call("submit_initial_payment", {
    booking_id: bookingId,
    method,
    reference: cleanReference,
    screenshot_path: screenshotPath,
    submission_key: submissionKey,
  });
  let reservationDeadline: BookingPaymentSubmissionResult["reservationDeadline"] = null;
  let reservationDeadlineError: string | null = null;
  try {
    reservationDeadline = await loadMyGuestBookingReservationDeadline(bookingId);
  } catch (error) {
    reservationDeadlineError = error instanceof Error
      ? error.message
      : "Could not refresh the reservation deadline.";
    console.error("Could not refresh the guest booking reservation deadline:", error);
  }
  const smsResult = await notifyBookingSms("payment_submitted", bookingId);
  return { ...smsResult, reservationDeadline, reservationDeadlineError };
}

export function cancelMyGuestBooking(bookingId: number) {
  requireId(bookingId, "booking");
  return call("guest_cancel", { booking_id: bookingId });
}

export async function getGuestBookingBoundaryDates(roomId: number): Promise<{ room_id: number; dates: string[] }> {
  requireId(roomId, "room");
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  const until = new Date(from);
  until.setDate(until.getDate() + 365);
  const formatDate = (date: Date) => [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");

  const { data, error } = await supabase.rpc("get_guest_booking_boundary_dates", {
    p_room_id: roomId,
    p_from: formatDate(from),
    p_until: formatDate(until),
  });
  if (error) throw new Error(error.message || "Could not load scheduled room dates.");
  if (!Array.isArray(data) || data.some((date) => typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date))) {
    throw new Error("The booking service returned invalid scheduled dates.");
  }

  return {
    room_id: roomId,
    dates: [...new Set(data)].sort(),
  };
}

export async function listAdminGuestBookings(): Promise<AdminGuestBooking[]> {
  const rows = await call<AdminGuestBooking[]>("admin_list");
  if (!Array.isArray(rows)) throw new Error("The booking service returned an invalid list.");
  const bookingsWithGender = await attachAdminBookingGender(rows);
  return Promise.all(bookingsWithGender.map(async booking => {
    if (!booking.gcash_submitted_screenshot) return booking;
    if (!isSupabaseStorageImagePath(booking.gcash_submitted_screenshot)) {
      return { ...booking, gcash_submitted_screenshot: null, proof_unavailable: true };
    }
    const { data, error } = await supabase.storage
      .from(proofBucket)
      .createSignedUrl(booking.gcash_submitted_screenshot, 300);
    if (error) throw new Error(error.message || "Could not open a payment proof.");
    return { ...booking, gcash_submitted_screenshot: data.signedUrl };
  }));
}

export function listAdminCancelledGuestBookings() {
  return call<AdminGuestBooking[]>("admin_cancelled_list")
    .then(attachAdminBookingGender);
}

async function attachAdminBookingGender(bookings: AdminGuestBooking[]): Promise<AdminGuestBooking[]> {
  const { data, error } = await supabase.rpc("list_admin_guest_booking_genders");
  if (error) throw new Error(error.message || "Could not load booking verification details.");
  if (!Array.isArray(data)) throw new Error("The booking service returned invalid verification details.");

  const genders = new Map<number, string | null>();
  for (const value of data) {
    if (!value || typeof value !== "object") {
      throw new Error("The booking service returned invalid verification details.");
    }
    const row = value as Record<string, unknown>;
    const gender = row.gender;
    if (typeof row.booking_id !== "number") {
      throw new Error("The booking service returned invalid verification details.");
    }
    if (gender === null) genders.set(row.booking_id, null);
    else if (typeof gender === "string") genders.set(row.booking_id, gender);
    else throw new Error("The booking service returned invalid verification details.");
  }
  return bookings.map(booking => ({
    ...booking,
    gender: genders.get(booking.booking_id) ?? null,
  }));
}

export async function confirmAdminBookingPayment(bookingId: number): Promise<BookingSmsNotificationResult> {
  requireId(bookingId, "booking");
  await call("admin_confirm_initial_payment", { booking_id: bookingId });
  return notifyBookingSms("booking_confirmed", bookingId);
}

export async function rejectAdminBookingPayment(
  bookingId: number,
  reason: string,
): Promise<BookingSmsNotificationResult> {
  requireId(bookingId, "booking");
  const cleanReason = reason.trim();
  if (!cleanReason || cleanReason.length > 300) {
    throw new Error("Enter a rejection reason of no more than 300 characters.");
  }
  const { data: response, error } = await supabase.rpc("reject_guest_booking_payment_with_reason", {
    p_booking_id: bookingId,
    p_reason: cleanReason,
  });
  if (error) throw new Error(error.message || "Could not reject the booking payment.");
  if (!response || typeof response !== "object" || Array.isArray(response) || response.type !== "success") {
    throw new Error("The booking service returned an invalid rejection response.");
  }
  return notifyBookingSms("booking_rejected", bookingId);
}

export function updateAdminGuestBookingStatus(bookingId: number, status: string) {
  requireId(bookingId, "booking");
  return call("admin_set_status", { booking_id: bookingId, status });
}

export function recordAdminGuestBookingPayment(input: {
  booking_id: number;
  amount: number;
  method: string;
  reference: string;
  idempotency_key: string;
}) {
  requireId(input.booking_id, "booking");
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw new Error("Enter a valid payment amount.");
  return call("admin_record_payment", input);
}
