import { supabase } from "@/lib/supabase";

export interface PublicRoom {
  room_id: number;
  room_number: string;
  room_type: string;
  capacity: number;
  monthly_rent: number | string;
  description: string | null;
  status: string;
  image: string | null;
  occupants?: number;
  available_beds?: number;
  available_for_dates?: boolean;
}

export interface PublicRoomPhoto {
  image_id: number;
  filename: string;
  caption: string;
  sort_order: number;
}

export function getPublicRoomImageUrl(image: string | null | undefined): string {
  if (!image) return "";
  if (/^(covers|photos)\/[1-9][0-9]*\/[A-Za-z0-9-]+\.(jpg|png|webp)$/.test(image)) {
    return supabase.storage.from("mbh-room-images").getPublicUrl(image).data.publicUrl;
  }
  return image.startsWith("blob:") ? image : "";
}

export async function getPublicRooms(): Promise<PublicRoom[]> {
  const { data, error } = await supabase.rpc("get_public_rooms");
  if (error) throw error;
  return (data ?? []) as PublicRoom[];
}

export async function getPublicRoomsForDates(checkInDate: string, checkOutDate: string): Promise<PublicRoom[]> {
  const { data, error } = await supabase.rpc("get_public_rooms_for_dates", {
    p_check_in_date: checkInDate,
    p_check_out_date: checkOutDate,
  });
  if (error) throw error;
  if (!Array.isArray(data)) throw new Error("The room availability service returned an invalid list.");
  return data as PublicRoom[];
}

export async function getPublicRoomPhotos(roomId: number): Promise<PublicRoomPhoto[]> {
  const { data, error } = await supabase.rpc("get_public_room_photos", { p_room_id: roomId });
  if (error) throw error;
  return (data ?? []) as PublicRoomPhoto[];
}
