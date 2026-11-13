import { supabase } from "@/lib/supabase";

export type AdminHouseSettings = Record<string, string>;

const allowedKeys = new Set([
  "house_address_line_1",
  "house_address_line_2",
  "house_contact_phone",
  "house_contact_email",
  "house_office_hours_line_1",
  "house_office_hours_line_2",
  "house_weekday_open_time",
  "house_weekday_close_time",
  "house_weekend_open_time",
  "house_weekend_close_time",
  "house_weekend_by_appointment",
  "house_map_lat",
  "house_map_lng",
]);

function parseSettings(value: unknown): AdminHouseSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The house settings service returned an invalid response.");
  }
  const settings: AdminHouseSettings = {};
  for (const [key, setting] of Object.entries(value)) {
    if (!allowedKeys.has(key) || typeof setting !== "string") {
      throw new Error("The house settings service returned an invalid setting.");
    }
    settings[key] = setting;
  }
  return settings;
}

export async function getMyAdminHouseSettings(): Promise<AdminHouseSettings> {
  const { data, error } = await supabase.rpc("get_my_admin_house_settings");
  if (error) throw new Error(error.message || "Could not load house settings.");
  return parseSettings(data);
}

export async function saveMyAdminHouseSettings(settings: AdminHouseSettings): Promise<void> {
  const entries = Object.entries(settings);
  if (!entries.length || entries.some(([key, value]) => !allowedKeys.has(key) || typeof value !== "string")) {
    throw new Error("The house settings update is invalid.");
  }
  const { error } = await supabase.rpc("save_my_admin_house_settings", {
    p_settings: settings,
  });
  if (error) throw new Error(error.message || "Could not save house settings.");
}
