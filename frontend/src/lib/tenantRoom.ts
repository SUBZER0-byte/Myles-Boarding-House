import { getPublicRooms, type PublicRoom } from "@/lib/publicRooms";
import { supabase } from "@/lib/supabase";

export interface TenantRoom {
  room_id: number;
  tenant_id: number;
  booking_id?: number | null;
  room_number: string;
  room_type: string;
  capacity: number;
  monthly_rent: number | string;
  status: string;
  description: string | null;
  move_in_date: string | null;
  move_out_date: string | null;
  check_out_date: string | null;
  requested_move_out_date: string | null;
  extension_request_status: string | null;
  tenant_name: string;
}

export async function getMyTenantRoom(): Promise<TenantRoom> {
  const { data, error } = await supabase.rpc("get_my_tenant_room");
  if (error) throw new Error(error.message || "Could not load your room.");
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("No active room assignment found.");
  }
  const row = data as Record<string, unknown>;
  if (
    typeof row.room_id !== "number"
    || typeof row.tenant_id !== "number"
    || typeof row.room_number !== "string"
    || typeof row.room_type !== "string"
    || typeof row.capacity !== "number"
    || (typeof row.monthly_rent !== "number" && typeof row.monthly_rent !== "string")
  ) {
    throw new Error("Your room information is incomplete.");
  }
  return {
    room_id: row.room_id,
    tenant_id: row.tenant_id,
    booking_id: typeof row.booking_id === "number" ? row.booking_id : null,
    room_number: row.room_number,
    room_type: row.room_type,
    capacity: row.capacity,
    monthly_rent: row.monthly_rent,
    status: typeof row.status === "string" ? row.status : "",
    description: typeof row.description === "string" ? row.description : null,
    move_in_date: typeof row.move_in_date === "string" ? row.move_in_date : null,
    move_out_date: typeof row.move_out_date === "string" ? row.move_out_date : null,
    check_out_date: typeof row.check_out_date === "string" ? row.check_out_date : null,
    requested_move_out_date: typeof row.requested_move_out_date === "string" ? row.requested_move_out_date : null,
    extension_request_status: typeof row.extension_request_status === "string" ? row.extension_request_status : null,
    tenant_name: typeof row.tenant_name === "string" ? row.tenant_name : "",
  };
}

export async function getAvailableTenantRooms(): Promise<PublicRoom[]> {
  const rooms = await getPublicRooms();
  return rooms.filter((room) => room.status === "Available");
}
