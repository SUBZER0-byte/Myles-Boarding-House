import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const {
  createAdminGuest,
  createAdminTenantFromGuest,
  getPublicRoomsForDates,
  refetch,
  tryRecordAdminManagementLog,
  toast,
  tenantList,
  updateAdminTenant,
  useSupabasePolling,
} = vi.hoisted(() => ({
  createAdminGuest: vi.fn(),
  createAdminTenantFromGuest: vi.fn(),
  getPublicRoomsForDates: vi.fn(),
  refetch: vi.fn(),
  tryRecordAdminManagementLog: vi.fn(),
  toast: vi.fn(),
  tenantList: [] as Array<Record<string, unknown>>,
  updateAdminTenant: vi.fn(),
  useSupabasePolling: vi.fn(),
}));

vi.mock("@/components/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast }),
}));
vi.mock("@/hooks/useSupabasePolling", () => ({
  useSupabasePolling,
}));
vi.mock("@/lib/profileSettings", () => ({
  getProfilePictureUrl: () => "",
}));
vi.mock("@/lib/adminLogs", () => ({
  tryRecordAdminManagementLog,
}));
vi.mock("@/lib/adminGuests", () => ({
  createAdminGuest,
}));
vi.mock("@/lib/adminTenants", () => ({
  createAdminTenantFromGuest,
  deleteAdminTenant: vi.fn(),
  findAdminTenantAccounts: vi.fn(),
  listAdminTenants: vi.fn(),
  setAdminTenantAccountStatus: vi.fn(),
  updateAdminTenant,
  uploadAdminTenantPicture: vi.fn(),
}));
vi.mock("@/lib/publicRooms", () => ({
  getPublicRoomsForDates,
}));

import AdminTenants from "@/pages/admin/AdminTenants";

describe("Admin tenant account creation", () => {
  const originalScrollIntoView = Element.prototype.scrollIntoView;

  beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  beforeEach(() => {
    tenantList.splice(0, tenantList.length);
    createAdminGuest.mockReset().mockResolvedValue(8);
    createAdminTenantFromGuest.mockReset().mockResolvedValue(12);
    updateAdminTenant.mockReset().mockResolvedValue({ type: "success" });
    getPublicRoomsForDates.mockReset().mockResolvedValue([{
      room_id: 4,
      room_number: "12",
      room_type: "Double",
      capacity: 2,
      monthly_rent: 1500,
      status: "Available",
      image: null,
      available_beds: 1,
      available_for_dates: true,
    }]);
    refetch.mockReset();
    useSupabasePolling.mockReset().mockReturnValue({ data: [], refetch, error: null });
    tryRecordAdminManagementLog.mockReset().mockResolvedValue(null);
    toast.mockReset();
  });

  afterEach(() => cleanup());
  afterAll(() => {
    Element.prototype.scrollIntoView = originalScrollIntoView;
  });

  it("calculates the tenant move-out date from the selected stay length", async () => {
    render(<AdminTenants />);

    fireEvent.click(screen.getByRole("button", { name: "Add Tenant" }));
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "New Tenant" } });
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "newtenant" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "tenant@example.test" } });
    fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "09170000000" } });
    fireEvent.change(screen.getByLabelText("Temporary password"), { target: { value: "initial-password" } });
    fireEvent.change(screen.getByLabelText("Move-in date"), { target: { value: "2026-12-01" } });
    fireEvent.change(screen.getByLabelText(/Length of Stay \(months\)/), { target: { value: "2" } });

    const roomSelect = screen.getByRole("combobox", { name: "Room No." });
    await waitFor(() => expect(getPublicRoomsForDates).toHaveBeenLastCalledWith("2026-12-01", "2027-02-01"));
    fireEvent.click(roomSelect);
    fireEvent.click(await screen.findByRole("option", { name: /Room 12/ }));
    fireEvent.click(screen.getByRole("button", { name: "Create Tenant" }));

    await waitFor(() => expect(createAdminGuest).toHaveBeenCalledWith({
      full_name: "New Tenant",
      username: "newtenant",
      email: "tenant@example.test",
      phone: "09170000000",
      address: "",
      birthday: "",
      emergency_contact_name: "",
      emergency_contact_phone: "",
      password: "initial-password",
    }));
    expect(createAdminTenantFromGuest).toHaveBeenCalledWith(8, 4, "2026-12-01", "2027-02-01");
    expect(tryRecordAdminManagementLog).toHaveBeenCalledWith({
      entity: "tenant",
      operation: "create",
      resourceId: 12,
      message: "Created Tenant record #12 for user #8 in room #4.",
    });
  });

  it("uses the calculated move-out date when an existing tenant is updated", async () => {
    tenantList.push({
      tenant_id: 3,
      user_id: 9,
      room_id: 4,
      full_name: "Existing Tenant",
      username: "existing",
      phone: "09170000000",
      email: "existing@example.test",
      address: null,
      age: null,
      birthday: null,
      emergency_contact_name: null,
      emergency_contact_phone: null,
      move_in_date: "2026-12-01",
      move_out_date: "2027-01-01",
      is_active: 1,
      room_number: "12",
      room_type: "Double",
      profile_picture: null,
    });
    useSupabasePolling.mockReturnValue({ data: tenantList, refetch, error: null });
    render(<AdminTenants />);

    fireEvent.click(screen.getByRole("button", { name: "Table view" }));
    const actionsButton = screen.getByRole("button", { name: "Actions for Existing Tenant" });
    fireEvent.pointerDown(actionsButton, {
      button: 0,
      ctrlKey: false,
      pointerType: "mouse",
    });
    fireEvent.keyDown(actionsButton, { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText(/Length of Stay \(months\)/), { target: { value: "2" } });
    expect(screen.getByLabelText("Move-out date (calculated)")).toHaveProperty("value", "2027-02-01");

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(updateAdminTenant).toHaveBeenCalledWith(expect.objectContaining({
      tenant_id: 3,
      move_in_date: "2026-12-01",
      move_out_date: "2027-02-01",
    })));
    expect(updateAdminTenant.mock.calls[0][0]).not.toHaveProperty("stay_months");
  });
});
