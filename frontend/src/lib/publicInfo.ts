import { supabase } from "@/lib/supabase";

export interface PublicAnnouncement {
  announcement_id: number;
  title: string;
  body: string;
  created_at: string;
}

export interface PublicHouseInfo {
  house_address_line_1: string;
  house_address_line_2: string;
  house_contact_phone: string;
  house_contact_email: string;
  house_office_hours_line_1: string;
  house_office_hours_line_2: string;
  house_map_lat: string;
  house_map_lng: string;
}

export async function getPublicAnnouncements(): Promise<PublicAnnouncement[]> {
  const { data, error } = await supabase.rpc("get_public_announcements");
  if (error) throw error;
  return (data ?? []) as PublicAnnouncement[];
}

export async function getPublicHouseInfo(): Promise<PublicHouseInfo> {
  const { data, error } = await supabase.rpc("get_public_house_info");
  if (error) throw error;
  const info = (data ?? [])[0] as PublicHouseInfo | undefined;
  if (!info) throw new Error("Public house information is unavailable.");
  return info;
}
