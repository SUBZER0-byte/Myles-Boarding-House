import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  createAdminGuest,
  refetch,
  toast,
  tryRecordAdminManagementLog,
} = vi.hoisted(() => ({
  createAdminGuest: vi.fn(),
  refetch: vi.fn(),
  toast: vi.fn(),
  tryRecordAdminManagementLog: vi.fn(),
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
vi.mock("@/lib/adminLogs", () => ({
  tryRecordAdminManagementLog,
}));
vi.mock("@/lib/adminGuests", () => ({
  createAdminGuest,
  deleteAdminGuest: vi.fn(),
  listAdminGuests: vi.fn(),
  setAdminGuestActive: vi.fn(),
  updateAdminGuest: vi.fn(),
  uploadAdminGuestPicture: vi.fn(),
}));

import AdminGuests from "@/pages/admin/AdminGuests";

describe("Admin guest account creation audit", () => {
  beforeEach(() => {
    createAdminGuest.mockReset().mockResolvedValue(8);
    refetch.mockReset();
    toast.mockReset();
    tryRecordAdminManagementLog.mockReset().mockResolvedValue(null);
  });

  afterEach(() => cleanup());

  it("records guest creation and the management page read", async () => {
    render(<AdminGuests />);

    fireEvent.click(screen.getByRole("button", { name: "Add Guest" }));
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "New Guest" } });
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "newguest" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "guest@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Guest" }));

    await waitFor(() => expect(createAdminGuest).toHaveBeenCalled());
    await waitFor(() => expect(tryRecordAdminManagementLog).toHaveBeenCalledWith({
      entity: "guest",
      operation: "create",
      resourceId: 8,
      message: "Created Guest user #8.",
    }));
    expect(tryRecordAdminManagementLog).toHaveBeenCalledWith({
      entity: "guest",
      operation: "read",
      resourceId: null,
      message: "Opened Guest Management.",
    });
  });
});
