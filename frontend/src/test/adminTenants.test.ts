import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke } },
}));

import {
  createAdminTenant,
  deactivateAdminTenant,
  deleteAdminTenant,
  findAdminTenantAccounts,
  listAdminTenants,
  updateAdminTenant,
  uploadAdminTenantPicture,
} from "@/lib/adminTenants";

describe("Admin tenant Supabase workflows", () => {
  beforeEach(() => invoke.mockReset());

  it("loads tenants and eligible account suggestions through the Admin function", async () => {
    const tenants = [{ tenant_id: 3, full_name: "Tenant" }];
    const suggestions = [{ user_id: 8, username: "tenant8" }];
    invoke.mockResolvedValueOnce({ data: { type: "success", data: tenants }, error: null });
    invoke.mockResolvedValueOnce({ data: { type: "success", data: suggestions }, error: null });

    await expect(listAdminTenants()).resolves.toEqual(tenants);
    await expect(findAdminTenantAccounts("tenant")).resolves.toEqual(suggestions);
    expect(invoke).toHaveBeenNthCalledWith(1, "admin-tenants", { body: { action: "list", data: {} } });
    expect(invoke).toHaveBeenNthCalledWith(2, "admin-tenants", {
      body: { action: "suggestions", data: { query: "tenant" } },
    });
  });

  it("creates, updates, deactivates, and deletes tenant records through the Admin function", async () => {
    invoke.mockResolvedValueOnce({ data: { type: "success", tenant_id: 9, user_id: 8 }, error: null });
    invoke.mockResolvedValue({ data: { type: "success" }, error: null });
    const tenant = { full_name: "New Tenant", email: "tenant@example.com" };

    await expect(createAdminTenant(tenant)).resolves.toMatchObject({ tenant_id: 9, user_id: 8 });
    await expect(updateAdminTenant({ ...tenant, tenant_id: 9 })).resolves.toMatchObject({ type: "success" });
    await deactivateAdminTenant(9);
    await deleteAdminTenant(9);

    expect(invoke).toHaveBeenNthCalledWith(1, "admin-tenants", { body: { action: "create", data: tenant } });
    expect(invoke).toHaveBeenNthCalledWith(2, "admin-tenants", {
      body: { action: "update", data: { ...tenant, tenant_id: 9 } },
    });
    expect(invoke).toHaveBeenNthCalledWith(3, "admin-tenants", {
      body: { action: "deactivate", data: { tenant_id: 9 } },
    });
    expect(invoke).toHaveBeenNthCalledWith(4, "admin-tenants", {
      body: { action: "delete", data: { tenant_id: 9 } },
    });
  });

  it("uploads supported profile pictures and rejects invalid files before invoking the function", async () => {
    invoke.mockResolvedValue({ data: { type: "success" }, error: null });
    const picture = new File(["image"], "tenant.png", { type: "image/png" });
    await expect(uploadAdminTenantPicture(8, picture)).resolves.toBeUndefined();
    expect(invoke.mock.calls[0][0]).toBe("admin-tenants");
    expect(invoke.mock.calls[0][1].body).toBeInstanceOf(FormData);

    invoke.mockReset();
    const invalidPicture = new File(["image"], "tenant.gif", { type: "image/gif" });
    await expect(uploadAdminTenantPicture(8, invalidPicture)).rejects.toThrow("must be JPG, PNG, or WEBP");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("surfaces errors returned by the function", async () => {
    invoke.mockResolvedValue({ data: { type: "error", message: "Tenant is linked to payment history." }, error: null });
    await expect(deleteAdminTenant(9)).rejects.toThrow("Tenant is linked to payment history.");
  });
});
