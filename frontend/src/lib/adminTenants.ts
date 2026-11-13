import { supabase } from "@/lib/supabase";

export interface AdminTenant {
  tenant_id: number;
  user_id: number | null;
  room_id: number | null;
  full_name: string;
  username: string | null;
  phone: string;
  email: string;
  address: string | null;
  age: number | string | null;
  birthday: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  move_in_date: string;
  move_out_date: string | null;
  is_active: number;
  room_number: string | null;
  room_type: string | null;
  profile_picture: string | null;
}

export interface AdminTenantAccountSuggestion {
  user_id: number;
  username: string;
  full_name: string;
  email: string;
  phone: string | null;
  address: string | null;
  birthday: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  user_type: string;
}

interface TenantResponse<T = unknown> {
  type: "success" | "error";
  message?: string;
  data?: T;
  tenant_id?: number;
  user_id?: number | null;
}

type TenantAction = "list" | "suggestions" | "create" | "update" | "deactivate" | "delete";

async function invokeTenantAction<T = unknown>(
  action: TenantAction,
  data: Record<string, unknown> = {},
): Promise<TenantResponse<T>> {
  const { data: response, error } = await supabase.functions.invoke<TenantResponse<T>>(
    "admin-tenants",
    { body: { action, data } },
  );
  if (error) {
    if (error.context instanceof Response) {
      try {
        const details = await error.context.clone().json() as TenantResponse;
        throw new Error(details.message || error.message);
      } catch (cause) {
        if (cause instanceof Error && cause.message !== error.message) throw cause;
      }
    }
    throw new Error(error.message || "Could not complete the tenant account action.");
  }
  if (!response || response.type !== "success") {
    throw new Error(response?.message || "Could not complete the tenant account action.");
  }
  return response;
}

export async function listAdminTenants(): Promise<AdminTenant[]> {
  const response = await invokeTenantAction<AdminTenant[]>("list");
  if (!Array.isArray(response.data)) throw new Error("The tenant service returned an invalid list.");
  return response.data;
}

export async function findAdminTenantAccounts(query: string): Promise<AdminTenantAccountSuggestion[]> {
  const response = await invokeTenantAction<AdminTenantAccountSuggestion[]>("suggestions", { query });
  if (!Array.isArray(response.data)) throw new Error("The tenant service returned invalid account suggestions.");
  return response.data;
}

export async function createAdminTenant(tenant: Record<string, unknown>): Promise<TenantResponse> {
  const response = await invokeTenantAction("create", tenant);
  if (typeof response.tenant_id !== "number") {
    throw new Error("The tenant service did not return the new tenant ID.");
  }
  return response;
}

export async function updateAdminTenant(tenant: Record<string, unknown>): Promise<TenantResponse> {
  return invokeTenantAction("update", tenant);
}

export async function deactivateAdminTenant(tenantId: number): Promise<void> {
  await invokeTenantAction("deactivate", { tenant_id: tenantId });
}

export async function deleteAdminTenant(tenantId: number): Promise<void> {
  await invokeTenantAction("delete", { tenant_id: tenantId });
}

export async function uploadAdminTenantPicture(userId: number, file: File): Promise<void> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024) {
    throw new Error("Profile picture must be JPG, PNG, or WEBP and 10MB or smaller.");
  }
  const formData = new FormData();
  formData.append("user_id", String(userId));
  formData.append("profile_picture", file);
  const { data, error } = await supabase.functions.invoke<TenantResponse>("admin-tenants", { body: formData });
  if (error) {
    if (error.context instanceof Response) {
      try {
        const details = await error.context.clone().json() as TenantResponse;
        throw new Error(details.message || error.message);
      } catch (cause) {
        if (cause instanceof Error && cause.message !== error.message) throw cause;
      }
    }
    throw new Error(error.message || "Could not upload the tenant profile picture.");
  }
  if (!data || data.type !== "success") {
    throw new Error(data?.message || "Could not upload the tenant profile picture.");
  }
}
