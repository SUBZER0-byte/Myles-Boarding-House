import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const { rooms, setMyAdminRoomStatus } = vi.hoisted(() => ({
  rooms: [{
    room_id: 4,
    room_number: "4",
    floor_number: 2,
    capacity: 2,
    monthly_rent: 4500,
    status: "Occupied",
    description: "Quiet room beside the garden",
    image: null,
    occupants: 1,
    occupant_genders: ["Male"],
    available_beds: 1,
    reservation_count: 1,
    reservation_deadlines_epoch: [Math.floor(Date.now() / 1000) + 3600],
    reservation_server_now_epoch: Math.floor(Date.now() / 1000),
  }],
  setMyAdminRoomStatus: vi.fn(),
}));

vi.mock("@/components/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/GuestRoomPhotoSlideshow", () => ({
  GuestRoomPhotoSlideshow: ({ roomNumber }: { roomNumber: string }) => (
    <div data-testid={`room-photos-${roomNumber}`} />
  ),
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
  const originalScrollIntoView = Element.prototype.scrollIntoView;

  beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterAll(() => {
    Element.prototype.scrollIntoView = originalScrollIntoView;
  });

  it("uses the guest room photo slideshow for room images", () => {
    render(<AdminRooms />);

    expect(screen.getByTestId("room-photos-4")).toBeInTheDocument();
  });

  it("shows the gender of the registered occupant for each occupied room", () => {
    render(<AdminRooms />);

    expect(screen.getByText("2nd Floor · cap 2")).toBeTruthy();
    expect(screen.getByText("Registered occupant gender(s): Male")).toBeTruthy();
    expect(screen.getByText("Reserved by 1 guest")).toBeTruthy();
    expect(screen.getByText(/Next expires in 1h/)).toBeTruthy();
  });

  it("filters Rooms Management by room number and description and can clear filters", async () => {
    render(<AdminRooms />);

    fireEvent.click(screen.getByRole("combobox", { name: "Filter by room number" }));
    fireEvent.click(await screen.findByRole("option", { name: "Room 4" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Description" }), {
      target: { value: "GARDEN" },
    });

    expect(screen.getByText("Room 4", { selector: "p" })).toBeTruthy();
    expect(screen.getByRole("status")).toHaveTextContent("Showing 1 of 1 room");

    fireEvent.change(screen.getByRole("searchbox", { name: "Description" }), {
      target: { value: "not present" },
    });

    expect(await screen.findByText("No rooms match your selected filters.")).toBeTruthy();
    expect(screen.getByRole("status")).toHaveTextContent("Showing 0 of 1 room");
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(await screen.findByText("Room 4", { selector: "p" })).toBeTruthy();
  });

  it("disables Available when a room is occupied or reserved", () => {
    render(<AdminRooms />);

    fireEvent.click(screen.getByRole("combobox", { name: "Set status for room 4" }));
    expect(screen.getByRole("option", { name: "Available" })).toHaveAttribute("aria-disabled", "true");
  });

  it("sends Occupied when selected instead of sending Available", async () => {
    rooms[0].status = "Available";
    setMyAdminRoomStatus.mockResolvedValue(undefined);
    render(<AdminRooms />);

    fireEvent.click(screen.getByRole("combobox", { name: "Set status for room 4" }));
    fireEvent.click(screen.getByRole("option", { name: "Occupied" }));

    await waitFor(() => expect(setMyAdminRoomStatus).toHaveBeenCalledWith(4, "Occupied"));
  });
});
