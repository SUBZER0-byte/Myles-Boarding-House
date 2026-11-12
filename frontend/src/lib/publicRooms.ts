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
}

export interface PublicRoomPhoto {
  image_id: number;
  filename: string;
  caption: string;
  sort_order: number;
}

export async function getPublicRooms(): Promise<PublicRoom[]> {
  const { data, error } = await supabase.rpc("get_public_rooms");
  if (error) throw error;
  return (data ?? []) as PublicRoom[];
}

export async function getPublicRoomPhotos(roomId: number): Promise<PublicRoomPhoto[]> {
  const { data, error } = await supabase.rpc("get_public_room_photos", { p_room_id: roomId });
  if (error) throw error;
  return (data ?? []) as PublicRoomPhoto[];
}
