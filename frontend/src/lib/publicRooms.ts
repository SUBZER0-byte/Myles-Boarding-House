import { supabase } from "@/lib/supabase";
import { isSupabaseStorageImagePath } from "@/lib/storagePaths";

export type OccupantGender = "Male" | "Female" | "Not provided";

export interface PublicRoom {
  room_id: number;
  room_number: string;
  floor_number: number;
  capacity: number;
  monthly_rent: number | string;
  description: string | null;
  status: string;
  image: string | null;
  occupant_genders?: OccupantGender[];
  has_active_booking?: boolean;
  occupants?: number;
  available_beds?: number;
  available_for_dates?: boolean;
  reservation_count?: number;
  reservation_deadlines_epoch?: number[];
  reservation_server_now_epoch?: number;
}

export function parseOccupantGenders(value: unknown): OccupantGender[] {
  if (value === undefined || value === null) return [];
  const isOccupantGender = (gender: unknown): gender is OccupantGender =>
    gender === "Male" || gender === "Female" || gender === "Not provided";
  if (!Array.isArray(value) || !value.every(isOccupantGender)) {
    throw new Error("The room service returned invalid occupant gender data.");
  }
  return [...new Set(value)];
}

export function parseFloorNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 32767) {
    throw new Error("The room service returned an invalid floor number.");
  }
  return value;
}

function parseReservationData(
  count: unknown,
  deadlines: unknown,
  serverNow: unknown,
): Pick<PublicRoom, "reservation_count" | "reservation_deadlines_epoch" | "reservation_server_now_epoch"> {
  if (
    typeof count !== "number"
    || !Number.isSafeInteger(count)
    || count < 0
    || !Array.isArray(deadlines)
    || deadlines.some((deadline) => typeof deadline !== "number" || !Number.isSafeInteger(deadline) || deadline <= 0)
    || deadlines.length !== count
    || typeof serverNow !== "number"
    || !Number.isSafeInteger(serverNow)
    || serverNow <= 0
  ) {
    throw new Error("The room service returned invalid reservation data.");
  }
  return {
    reservation_count: count,
    reservation_deadlines_epoch: deadlines,
    reservation_server_now_epoch: serverNow,
  };
}

export function getCurrentPhilippineDate(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((value) => value.type === type)?.value;
  const year = part("year");
  const month = part("month");
  const day = part("day");
  if (!year || !month || !day) throw new Error("Could not determine the current Philippine date.");
  return `${year}-${month}-${day}`;
}

function nextPhilippineDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const tomorrow = new Date(Date.UTC(year, month - 1, day + 1));
  return [
    tomorrow.getUTCFullYear(),
    String(tomorrow.getUTCMonth() + 1).padStart(2, "0"),
    String(tomorrow.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

export interface PublicRoomPhoto {
  image_id: number;
  filename: string;
  caption: string;
  sort_order: number;
}

export function compareRoomNumbers(first: string, second: string): number {
  return first.localeCompare(second, undefined, { numeric: true, sensitivity: "base" });
}

export function getPublicRoomImageUrl(image: string | null | undefined): string {
  if (!image) return "";
  if (image.startsWith("blob:")) return image;
  if (isSupabaseStorageImagePath(image)) {
    return supabase.storage.from("mbh-room-images").getPublicUrl(image).data.publicUrl;
  }
  return "";
}

export async function getPublicRooms(): Promise<PublicRoom[]> {
  const checkInDate = getCurrentPhilippineDate();
  const checkOutDate = nextPhilippineDate(checkInDate);

  const { data, error } = await supabase.rpc("get_public_rooms_for_guest_browse_with_booking_state", {
    p_check_in_date: checkInDate,
    p_check_out_date: checkOutDate,
  });
  if (error) throw error;
  if (!Array.isArray(data)) throw new Error("The room service returned an invalid list.");
  return [...data as PublicRoom[]]
    .map((room) => ({
      ...room,
      floor_number: parseFloorNumber(room.floor_number),
      occupant_genders: parseOccupantGenders(room.occupant_genders),
      ...parseReservationData(
        room.reservation_count,
        room.reservation_deadlines_epoch,
        room.reservation_server_now_epoch,
      ),
    }))
    .sort((a, b) => compareRoomNumbers(a.room_number, b.room_number));
}

export async function getPublicRoomsForDates(checkInDate: string, checkOutDate: string): Promise<PublicRoom[]> {
  const { data, error } = await supabase.rpc("get_public_rooms_for_guest_browse_with_booking_state", {
    p_check_in_date: checkInDate,
    p_check_out_date: checkOutDate,
  });
  if (error) throw error;
  if (!Array.isArray(data)) throw new Error("The room availability service returned an invalid list.");
  return [...data as PublicRoom[]]
    .map((room) => {
      if (typeof room.has_active_booking !== "boolean") {
        throw new Error("The room service returned invalid booking ownership data.");
      }

      return {
        ...room,
        floor_number: parseFloorNumber(room.floor_number),
        occupant_genders: parseOccupantGenders(room.occupant_genders),
        has_active_booking: room.has_active_booking,
        ...parseReservationData(
          room.reservation_count,
          room.reservation_deadlines_epoch,
          room.reservation_server_now_epoch,
        ),
      };
    })
    .sort((a, b) => compareRoomNumbers(a.room_number, b.room_number));
}

export async function getPublicRoomPhotos(roomId: number): Promise<PublicRoomPhoto[]> {
  const { data, error } = await supabase.rpc("get_public_room_photos", { p_room_id: roomId });
  if (error) throw error;
  return (data ?? []) as PublicRoomPhoto[];
}
