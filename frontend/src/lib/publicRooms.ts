import { supabase } from "@/lib/supabase";
import { isSupabaseStorageImagePath } from "@/lib/storagePaths";

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
  if (image.startsWith("blob:")) return image;
  if (isSupabaseStorageImagePath(image)) {
    return supabase.storage.from("mbh-room-images").getPublicUrl(image).data.publicUrl;
  }
  return "";
}

export async function getPublicRooms(): Promise<PublicRoom[]> {
  const { data, error } = await supabase.rpc("get_public_rooms");
  if (error) throw error;
  return (data ?? []) as PublicRoom[];
}

export async function getPublicRoomsForDates(checkInDate: string, checkOutDate: string): Promise<PublicRoom[]> {
  const [roomsResult, availabilityResult] = await Promise.all([
    supabase.rpc("get_public_rooms"),
    supabase.rpc("get_public_rooms_for_dates", {
      p_check_in_date: checkInDate,
      p_check_out_date: checkOutDate,
    }),
  ]);
  if (roomsResult.error) throw roomsResult.error;
  if (availabilityResult.error) throw availabilityResult.error;
  if (!Array.isArray(roomsResult.data)) throw new Error("The room status service returned an invalid list.");
  if (!Array.isArray(availabilityResult.data)) throw new Error("The room availability service returned an invalid list.");

  const currentRooms = new Map(
    (roomsResult.data as PublicRoom[]).map((room) => [room.room_id, room]),
  );
  return (availabilityResult.data as PublicRoom[]).map((room) => {
    const currentRoom = currentRooms.get(room.room_id);
    if (!currentRoom) throw new Error("The room status and availability lists do not match.");
    return { ...room, status: currentRoom.status };
  });
}

export async function getPublicRoomPhotos(roomId: number): Promise<PublicRoomPhoto[]> {
  const { data, error } = await supabase.rpc("get_public_room_photos", { p_room_id: roomId });
  if (error) throw error;
  return (data ?? []) as PublicRoomPhoto[];
}
