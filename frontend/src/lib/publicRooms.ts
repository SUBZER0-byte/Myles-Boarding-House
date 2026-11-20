import { supabase } from "@/lib/supabase";
import { isSupabaseStorageImagePath } from "@/lib/storagePaths";

export type OccupantGender = "Male" | "Female" | "Not provided";

export interface PublicRoom {
  room_id: number;
  room_number: string;
  room_type: string;
  capacity: number;
  monthly_rent: number | string;
  description: string | null;
  status: string;
  image: string | null;
  occupant_genders?: OccupantGender[];
  occupants?: number;
  available_beds?: number;
  available_for_dates?: boolean;
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
  const { data, error } = await supabase.rpc("get_public_rooms_with_occupant_genders");
  if (error) throw error;
  if (!Array.isArray(data)) throw new Error("The room service returned an invalid list.");
  return [...data as PublicRoom[]]
    .map((room) => ({ ...room, occupant_genders: parseOccupantGenders(room.occupant_genders) }))
    .sort((a, b) => compareRoomNumbers(a.room_number, b.room_number));
}

export async function getPublicRoomsForDates(checkInDate: string, checkOutDate: string): Promise<PublicRoom[]> {
  const { data, error } = await supabase.rpc("get_public_rooms_for_guest_browse_with_occupant_genders", {
    p_check_in_date: checkInDate,
    p_check_out_date: checkOutDate,
  });
  if (error) throw error;
  if (!Array.isArray(data)) throw new Error("The room availability service returned an invalid list.");
  return [...data as PublicRoom[]]
    .map((room) => ({ ...room, occupant_genders: parseOccupantGenders(room.occupant_genders) }))
    .sort((a, b) => compareRoomNumbers(a.room_number, b.room_number));
}

export async function getPublicRoomPhotos(roomId: number): Promise<PublicRoomPhoto[]> {
  const { data, error } = await supabase.rpc("get_public_room_photos", { p_room_id: roomId });
  if (error) throw error;
  return (data ?? []) as PublicRoomPhoto[];
}
