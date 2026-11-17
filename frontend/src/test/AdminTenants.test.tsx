import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const {
  createAdminGuest,
  createAdminTenantFromGuest,
  getPublicRoomsForDates,
  refetch,
  toast,
} = vi.hoisted(() => ({
  createAdminGuest: vi.fn(),
  createAdminTenantFromGuest: vi.fn(),
  getPublicRoomsForDates: vi.fn(),
  refetch: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/components/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast }),
}));
vi.mock("@/hooks/useSupabasePolling", () => ({
  useSupabasePolling: () => ({ data: [], refetch, error: null }),
}));
vi.mock("@/lib/profileSettings", () => ({
  getProfilePictureUrl: () => "",
}));
vi.mock("@/lib/adminGuests", () => ({
  createAdminGuest,
}));
vi.mock("@/lib/adminTenants", () => ({
  createAdminTenantFromGuest,
  deactivateAdminTenant: vi.fn(),
  deleteAdminTenant: vi.fn(),
  findAdminTenantAccounts: vi.fn(),
  listAdminTenants: vi.fn(),
  updateAdminTenant: vi.fn(),
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
    createAdminGuest.mockReset().mockResolvedValue(8);
    createAdminTenantFromGuest.mockReset().mockResolvedValue(12);
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
    toast.mockReset();
  });

  afterEach(() => cleanup());
  afterAll(() => {
    Element.prototype.scrollIntoView = originalScrollIntoView;
  });

  it("creates a tenant login, assigns an available room, and preserves stay dates", async () => {
    render(<AdminTenants />);

    fireEvent.click(screen.getByRole("button", { name: "Add Tenant" }));
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "New Tenant" } });
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "newtenant" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "tenant@example.test" } });
    fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "09170000000" } });
    fireEvent.change(screen.getByLabelText("Temporary password"), { target: { value: "initial-password" } });
    fireEvent.change(screen.getByLabelText("Move-in date"), { target: { value: "2026-12-01" } });
    fireEvent.change(screen.getByLabelText("Move-out date (optional)"), { target: { value: "2027-01-01" } });

    const roomSelect = screen.getByRole("combobox", { name: "Room No." });
    await waitFor(() => expect(getPublicRoomsForDates).toHaveBeenLastCalledWith("2026-12-01", "2027-01-01"));
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
    expect(createAdminTenantFromGuest).toHaveBeenCalledWith(8, 4, "2026-12-01", "2027-01-01");
  });
});
