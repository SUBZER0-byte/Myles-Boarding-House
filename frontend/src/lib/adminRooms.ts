import { getPublicRoomImageUrl } from "@/lib/publicRooms";
import { supabase } from "@/lib/supabase";

export interface AdminRoom {
  room_id: number;
  room_number: string;
  room_type: string;
  capacity: number;
  monthly_rent: number;
  status: string;
  description: string | null;
  image: string | null;
  occupants: number;
}

export interface AdminRoomInput {
  room_id: number | null;
  room_number: string;
  room_type: string;
  capacity: number;
  monthly_rent: number;
  status: string;
  description: string;
}

export interface AdminRoomPhoto {
  image_id: number;
  filename: string;
  caption: string;
  sort_order: number;
}

interface PhotoRpcResponse<T> {
  type: "success" | "error";
  message?: string;
  data?: T;
}

async function callPhotoRpc<T>(action: string, data: Record<string, unknown>): Promise<T> {
  const { data: response, error } = await supabase.rpc("manage_my_admin_room_photo", {
    p_action: action,
    p_data: data,
  });
  if (error) throw new Error(error.message || "Could not update room photos.");
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    throw new Error("The room photo service returned an invalid response.");
  }
  const result = response as PhotoRpcResponse<T>;
  if (result.type !== "success") throw new Error(result.message || "Could not update room photos.");
  return result.data as T;
}

export async function getMyAdminRoomPhotos(roomId: number): Promise<AdminRoomPhoto[]> {
  const photos = await callPhotoRpc<unknown>("list", { room_id: roomId });
  if (!Array.isArray(photos)) throw new Error("The room photo service returned an invalid response.");
  return photos.map((photo) => {
    if (!photo || typeof photo !== "object" || Array.isArray(photo)) {
      throw new Error("The room photo service returned invalid photo data.");
    }
    const row = photo as Record<string, unknown>;
    if (
      typeof row.image_id !== "number"
      || typeof row.filename !== "string"
      || typeof row.sort_order !== "number"
    ) {
      throw new Error("The room photo service returned incomplete photo data.");
    }
    return {
      image_id: row.image_id,
      filename: row.filename,
      caption: typeof row.caption === "string" ? row.caption : "",
      sort_order: row.sort_order,
    };
  });
}

export function getAdminRoomPhotoUrl(filename: string): string {
  if (/^photos\/[1-9][0-9]*\/[A-Za-z0-9-]+\.(jpg|png|webp)$/.test(filename)) {
    return supabase.storage.from("mbh-room-images").getPublicUrl(filename).data.publicUrl;
  }
  return filename.startsWith("blob:") ? filename : "";
}

export async function addMyAdminRoomPhoto(
  roomId: number,
  file: File,
  caption: string,
  sortOrder: number,
): Promise<void> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024) {
    throw new Error("Room photos must be JPG, PNG, or WEBP and 10MB or smaller.");
  }
  const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `photos/${roomId}/${crypto.randomUUID()}.${extension}`;
  const { error: uploadError } = await supabase.storage.from("mbh-room-images").upload(path, file, {
    contentType: file.type,
    upsert: false,
  });
  if (uploadError) throw new Error(uploadError.message || "Could not upload the room photo.");

  try {
    await callPhotoRpc("create", {
      room_id: roomId,
      filename: path,
      caption,
      sort_order: sortOrder,
    });
  } catch (error) {
    const { error: cleanupError } = await supabase.storage.from("mbh-room-images").remove([path]);
    if (cleanupError) console.error("Could not remove an unlinked room photo:", cleanupError);
    throw error;
  }
}

export async function saveMyAdminRoomPhotoCaption(imageId: number, caption: string): Promise<void> {
  await callPhotoRpc("update_caption", { image_id: imageId, caption });
}

export async function moveMyAdminRoomPhoto(imageId: number, direction: "up" | "down"): Promise<void> {
  await callPhotoRpc("move", { image_id: imageId, direction });
}

export async function deleteMyAdminRoomPhoto(imageId: number): Promise<void> {
  const result = await callPhotoRpc<{ filename: string }>("delete", { image_id: imageId });
  if (!result || typeof result.filename !== "string") {
    throw new Error("The room photo service returned an invalid delete response.");
  }
  if (/^photos\/[1-9][0-9]*\/[A-Za-z0-9-]+\.(jpg|png|webp)$/.test(result.filename)) {
    const { error } = await supabase.storage.from("mbh-room-images").remove([result.filename]);
    if (error) throw new Error(`Photo record removed, but its storage file could not be deleted: ${error.message}`);
  }
}

function parseRooms(value: unknown): AdminRoom[] {
  if (!Array.isArray(value)) throw new Error("The room service returned an invalid response.");
  return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("The room service returned an invalid room.");
    }
    const row = item as Record<string, unknown>;
    if (
      typeof row.room_id !== "number"
      || typeof row.room_number !== "string"
      || typeof row.room_type !== "string"
      || typeof row.capacity !== "number"
      || (typeof row.monthly_rent !== "number" && typeof row.monthly_rent !== "string")
      || typeof row.status !== "string"
    ) {
      throw new Error("The room service returned incomplete room data.");
    }
    return {
      room_id: row.room_id,
      room_number: row.room_number,
      room_type: row.room_type,
      capacity: row.capacity,
      monthly_rent: Number(row.monthly_rent),
      status: row.status,
      description: typeof row.description === "string" ? row.description : null,
      image: typeof row.image === "string" ? row.image : null,
      occupants: typeof row.occupants === "number" ? row.occupants : 0,
    };
  });
}

export async function getMyAdminRooms(): Promise<AdminRoom[]> {
  const { data, error } = await supabase.rpc("get_my_admin_rooms");
  if (error) throw new Error(error.message || "Could not load rooms.");
  return parseRooms(data);
}

export async function saveMyAdminRoom(room: AdminRoomInput): Promise<number> {
  if (
    !room.room_number.trim()
    || !room.room_type.trim()
    || !Number.isInteger(room.capacity)
    || room.capacity < 1
    || !Number.isFinite(room.monthly_rent)
    || room.monthly_rent < 0
  ) {
    throw new Error("Enter valid room details.");
  }
  const { data, error } = await supabase.rpc("save_my_admin_room", {
    p_room_id: room.room_id,
    p_room_number: room.room_number,
    p_room_type: room.room_type,
    p_capacity: room.capacity,
    p_monthly_rent: room.monthly_rent,
    p_status: room.status,
    p_description: room.description,
  });
  if (error) throw new Error(error.message || "Could not save room details.");
  if (typeof data !== "number" || !Number.isInteger(data) || data < 1) {
    throw new Error("The room service did not return a valid room ID.");
  }
  return data;
}

export async function setMyAdminRoomStatus(roomId: number, status: string): Promise<void> {
  const { error } = await supabase.rpc("set_my_admin_room_status", {
    p_room_id: roomId,
    p_status: status,
  });
  if (error) throw new Error(error.message || "Could not update room status.");
}

export async function deleteMyAdminRoom(roomId: number): Promise<void> {
  const rooms = await getMyAdminRooms();
  const previousImage = rooms.find((room) => room.room_id === roomId)?.image;
  const { error } = await supabase.rpc("delete_my_admin_room", { p_room_id: roomId });
  if (error) throw new Error(error.message || "Could not delete the room.");
  if (previousImage && /^covers\/[1-9][0-9]*\/[A-Za-z0-9-]+\.(jpg|png|webp)$/.test(previousImage)) {
    const { error: removeError } = await supabase.storage.from("mbh-room-images").remove([previousImage]);
    if (removeError) throw new Error(`Room deleted, but its cover image could not be removed: ${removeError.message}`);
  }
}

export function getAdminRoomCoverUrl(image: string | null | undefined): string {
  return getPublicRoomImageUrl(image);
}

export async function uploadMyAdminRoomCover(roomId: number, file: File, oldPath?: string | null): Promise<string> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024) {
    throw new Error("Room image must be JPG, PNG, or WEBP and 10MB or smaller.");
  }
  const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `covers/${roomId}/${crypto.randomUUID()}.${extension}`;
  const { error: uploadError } = await supabase.storage.from("mbh-room-images").upload(path, file, {
    contentType: file.type,
    upsert: false,
  });
  if (uploadError) throw new Error(uploadError.message || "Could not upload the room image.");

  const { error: linkError } = await supabase.rpc("set_my_admin_room_cover", {
    p_room_id: roomId,
    p_image_path: path,
  });
  if (linkError) {
    const { error: cleanupError } = await supabase.storage.from("mbh-room-images").remove([path]);
    if (cleanupError) console.error("Could not remove an unlinked room cover image:", cleanupError);
    throw new Error(linkError.message || "Could not save the room image.");
  }

  if (oldPath && /^covers\/[1-9][0-9]*\/[A-Za-z0-9-]+\.(jpg|png|webp)$/.test(oldPath)) {
    const { error: removeError } = await supabase.storage.from("mbh-room-images").remove([oldPath]);
    if (removeError) console.error("Could not remove the previous room cover image:", removeError);
  }
  return path;
}
