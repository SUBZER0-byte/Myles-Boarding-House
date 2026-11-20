import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { rooms, setMyAdminRoomStatus } = vi.hoisted(() => ({
  rooms: [{
    room_id: 4,
    room_number: "4",
    floor_number: 2,
    capacity: 2,
    monthly_rent: 4500,
    status: "Occupied",
    description: null,
    image: null,
    occupants: 1,
    occupant_genders: ["Male"],
  }],
  setMyAdminRoomStatus: vi.fn(),
}));

vi.mock("@/components/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/useSupabasePolling", () => ({
  useSupabasePolling: () => ({ data: rooms, refetch: vi.fn(), error: null }),
}));
vi.mock("@/lib/adminRooms", () => ({
  deleteMyAdminRoom: vi.fn(),
  getAdminRoomCoverUrl: () => "",
  getMyAdminRooms: vi.fn(),
  saveMyAdminRoom: vi.fn(),
  setMyAdminRoomStatus,
  uploadMyAdminRoomCover: vi.fn(),
}));

import AdminRooms from "@/pages/admin/AdminRooms";

describe("AdminRooms", () => {
  it("shows the gender of the registered occupant for each occupied room", () => {
    render(<AdminRooms />);

    expect(screen.getByText("2nd Floor · cap 2")).toBeTruthy();
    expect(screen.getByText("Registered occupant gender(s): Male")).toBeTruthy();
  });

  it("disables Available when a room is occupied or reserved", () => {
    render(<AdminRooms />);

    fireEvent.click(screen.getByRole("combobox"));
    expect(screen.getByRole("option", { name: "Available" })).toHaveAttribute("aria-disabled", "true");
  });

  it("sends Occupied when selected instead of sending Available", async () => {
    rooms[0].status = "Available";
    setMyAdminRoomStatus.mockResolvedValue(undefined);
    render(<AdminRooms />);

    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(screen.getByRole("option", { name: "Occupied" }));

    await waitFor(() => expect(setMyAdminRoomStatus).toHaveBeenCalledWith(4, "Occupied"));
  });
});
