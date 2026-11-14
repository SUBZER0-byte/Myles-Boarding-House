import { supabase } from "@/lib/supabase";
import { isSupabaseStorageImagePath } from "@/lib/storagePaths";

const proofBucket = "mbh-booking-payment-proofs";

export interface GuestBooking {
  booking_id: number;
  full_name: string;
  email: string;
  phone: string | null;
  room_id: number | null;
  room_number: string | null;
  room_type: string | null;
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

function requireId(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`A valid ${label} is required.`);
}

export function listMyGuestBookings() {
  return call<GuestBooking[]>("guest_list");
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

export function createMyGuestBooking(input: {
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
  return call<{
    booking_id: number;
    initial_payment_amount: number;
    payment_expires_at_epoch: number;
    server_now_epoch: number;
  }>("create", input);
}

export async function submitMyBookingInitialPayment(
  bookingId: number,
  method: string,
  reference: string,
  screenshot: File | undefined,
  submissionKey: string,
) {
  requireId(bookingId, "booking");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(submissionKey)) {
    throw new Error("A valid payment submission identifier is required.");
  }
  let screenshotPath: string | null = null;
  if (screenshot) {
    if (!["image/jpeg", "image/png", "image/webp"].includes(screenshot.type)
      || screenshot.size <= 0
      || screenshot.size > 5 * 1024 * 1024) {
      throw new Error("Payment proof must be a JPG, PNG, or WEBP image up to 5 MB.");
    }
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError) throw new Error(authError.message || "Could not verify your account.");
    if (!authData.user) throw new Error("Sign in to submit a booking payment.");
    const extension = screenshot.type === "image/png" ? "png" : screenshot.type === "image/webp" ? "webp" : "jpg";
    screenshotPath = `${authData.user.id}/${bookingId}/${submissionKey}.${extension}`;
    const { error: uploadError } = await supabase.storage
      .from(proofBucket)
      .upload(screenshotPath, screenshot, { contentType: screenshot.type, upsert: false });
    if (uploadError && !/already exists|duplicate/i.test(uploadError.message)) {
      throw new Error(uploadError.message || "Could not upload the payment proof.");
    }
  }
  await call("submit_initial_payment", {
    booking_id: bookingId,
    method,
    reference,
    screenshot_path: screenshotPath,
    submission_key: submissionKey,
  });
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
  if (error) throw new Error(error.message || "Could not load unavailable dates.");
  if (!Array.isArray(data) || data.some(date => typeof date !== "string")) {
    throw new Error("The booking service returned invalid unavailable dates.");
  }
  return { room_id: roomId, dates: data as string[] };
}

export async function listAdminGuestBookings(): Promise<AdminGuestBooking[]> {
  const rows = await call<AdminGuestBooking[]>("admin_list");
  if (!Array.isArray(rows)) throw new Error("The booking service returned an invalid list.");
  return Promise.all(rows.map(async booking => {
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
  return call<AdminGuestBooking[]>("admin_cancelled_list");
}

export function confirmAdminBookingPayment(bookingId: number) {
  requireId(bookingId, "booking");
  return call("admin_confirm_initial_payment", { booking_id: bookingId });
}

export function rejectAdminBookingPayment(bookingId: number) {
  requireId(bookingId, "booking");
  return call("admin_reject_initial_payment", { booking_id: bookingId });
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
