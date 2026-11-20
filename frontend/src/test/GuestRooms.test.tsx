import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { addMonths, format } from "date-fns";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  acquireMyGuestRoomHold,
  releaseMyGuestRoomHold,
  getGuestBookingBoundaryDates,
  refetchRooms,
  room,
} = vi.hoisted(() => ({
  acquireMyGuestRoomHold: vi.fn(),
  releaseMyGuestRoomHold: vi.fn(),
  getGuestBookingBoundaryDates: vi.fn(),
  refetchRooms: vi.fn(),
  room: {
    room_id: 1,
    room_number: "11",
    floor_number: 1,
    capacity: 1,
    monthly_rent: 1000,
    description: null,
    status: "Available",
    image: null,
    occupants: 0,
    occupant_genders: [],
    available_beds: 1,
    available_for_dates: true,
    has_active_booking: false,
  },
}));

vi.mock("@/components/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/GuestRoomPhotoSlideshow", () => ({
  GuestRoomPhotoSlideshow: () => null,
}));
vi.mock("@/components/BookingPaymentDialog", () => ({
  BookingPaymentDialog: () => null,
}));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));
vi.mock("@/hooks/useSupabasePolling", () => ({
  useSupabasePolling: (_load: unknown, interval: number) => ({
    data: interval === 10000 ? [room] : { room_id: room.room_id, dates: [] },
    error: null,
    loading: false,
    refetch: refetchRooms,
  }),
}));
vi.mock("@/lib/api", () => ({
  sessionStore: {
    get: () => ({
      full_name: "Guest User",
      username: "guest",
      email: "guest@example.test",
      phone: "09170000000",
    }),
  },
}));
vi.mock("@/lib/guestBookings", () => ({
  acquireMyGuestRoomHold,
  createMyGuestBooking: vi.fn(),
  getGuestBookingBoundaryDates,
  releaseMyGuestRoomHold,
  submitMyBookingInitialPayment: vi.fn(),
}));
vi.mock("@/lib/publicRooms", () => ({
  getPublicRoomsForDates: vi.fn(),
}));
vi.mock("@/lib/savedRooms", () => ({
  readSavedRoomIds: () => [],
  writeSavedRoomIds: vi.fn(),
}));

import GuestRooms from "@/pages/guest/GuestRooms";

describe("GuestRooms temporary hold cancellation", () => {
  beforeEach(() => {
    Object.assign(room, {
      status: "Available",
      capacity: 1,
      monthly_rent: 1000,
      occupant_genders: [],
      available_beds: 1,
      available_for_dates: true,
      has_active_booking: false,
    });
    acquireMyGuestRoomHold.mockReset().mockResolvedValue({ expires_at: "2026-11-14T22:17:00Z" });
    releaseMyGuestRoomHold.mockReset().mockResolvedValue(null);
    getGuestBookingBoundaryDates.mockReset().mockResolvedValue({ room_id: room.room_id, dates: [] });
    refetchRooms.mockReset();
  });

  afterEach(() => cleanup());

  it("shows the current database room status in the room card and quick view", async () => {
    room.status = "Occupied";
    render(<GuestRooms />);

    expect(await screen.findByText("Occupied")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Quick view" }));
    expect(within(screen.getByRole("dialog")).getByText("Occupied")).toBeTruthy();
  });

  it("shows the current occupant gender in Browse Rooms and its quick view", async () => {
    room.occupant_genders = ["Female"];
    render(<GuestRooms />);

    expect(await screen.findByText("Registered occupant gender(s): Female")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Quick view" }));
    expect(within(screen.getByRole("dialog")).getByText("Registered occupant gender(s): Female")).toBeTruthy();
  });

  it("prevents booking the same room again while it is in the guest's active bookings", async () => {
    room.has_active_booking = true;
    render(<GuestRooms />);

    const cardButton = await screen.findByRole("button", { name: "Already in My Bookings" });
    expect(cardButton).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Quick view" }));
    expect(within(screen.getByRole("dialog")).getByRole("button", { name: "Already in My Bookings" }))
      .toBeDisabled();
    expect(acquireMyGuestRoomHold).not.toHaveBeenCalled();
  });

  it("releases the five-minute hold when the terms modal is closed before a booking is saved", async () => {
    render(<GuestRooms />);

    fireEvent.click(await screen.findByRole("button", { name: "Book Now" }));
    await screen.findByRole("heading", { name: "Terms & Agreement" });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() => expect(releaseMyGuestRoomHold).toHaveBeenCalledOnce());
    expect(acquireMyGuestRoomHold).toHaveBeenCalledOnce();
    expect(refetchRooms).toHaveBeenCalled();
  });

  it("releases the hold when booking details are closed before a booking is saved", async () => {
    render(<GuestRooms />);

    fireEvent.click(await screen.findByRole("button", { name: "Book Now" }));
    await screen.findByRole("heading", { name: "Terms & Agreement" });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Agree & Continue" }));
    await screen.findByRole("heading", { name: "Booking Details" });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() => expect(releaseMyGuestRoomHold).toHaveBeenCalledOnce());
    expect(acquireMyGuestRoomHold).toHaveBeenCalledOnce();
    expect(refetchRooms).toHaveBeenCalled();
  });

  it("calculates the move-out date when the guest changes the stay length", async () => {
    render(<GuestRooms />);

    fireEvent.click(await screen.findByRole("button", { name: "Book Now" }));
    await screen.findByRole("heading", { name: "Terms & Agreement" });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Agree & Continue" }));
    await screen.findByRole("heading", { name: "Booking Details" });

    fireEvent.click(screen.getByRole("button", { name: "Select move-in date" }));
    const moveInDate = new Date();
    moveInDate.setHours(0, 0, 0, 0);
    fireEvent.click(screen.getByRole("gridcell", { name: String(moveInDate.getDate()) }));
    fireEvent.change(screen.getByLabelText("Length of Stay (months)"), { target: { value: "3" } });

    const moveOutDate = addMonths(moveInDate, 3);
    expect(screen.getByLabelText("Move-out Date (calculated)")).toHaveProperty(
      "value",
      format(moveOutDate, "PPP"),
    );
  });

  it("calculates booking rent from the per-person rate, not room capacity", async () => {
    room.capacity = 4;
    room.available_beds = 4;
    render(<GuestRooms />);

    fireEvent.click(await screen.findByRole("button", { name: "Book Now" }));
    await screen.findByRole("heading", { name: "Terms & Agreement" });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Agree & Continue" }));
    await screen.findByRole("heading", { name: "Booking Details" });

    fireEvent.click(screen.getByRole("button", { name: "Select move-in date" }));
    const moveInDate = new Date();
    moveInDate.setHours(0, 0, 0, 0);
    fireEvent.click(screen.getByRole("gridcell", { name: String(moveInDate.getDate()) }));
    fireEvent.change(screen.getByLabelText("Length of Stay (months)"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue to Payment Plan" }));

    expect(await screen.findByText(/Estimated total for 1 person:/)).toHaveTextContent("₱2,000");
    fireEvent.click(screen.getByRole("button", { name: "Review Booking" }));

    expect(screen.getByText(/Monthly rent per person:/).parentElement).toHaveTextContent("₱1,000");
    expect(screen.getByText(/Total rent for 1 person:/).parentElement).toHaveTextContent("₱2,000");
    expect(screen.getByText(/Payment required today:/)).toHaveTextContent("₱2,000");
  });

  it("does not leave a hold or reopen booking when the quick view closes during hold acquisition", async () => {
    let resolveAcquire!: (value: { expires_at: string }) => void;
    acquireMyGuestRoomHold.mockReturnValueOnce(new Promise((resolve) => {
      resolveAcquire = resolve;
    }));
    render(<GuestRooms />);

    fireEvent.click(await screen.findByRole("button", { name: "Quick view" }));
    const quickView = screen.getByRole("dialog");
    fireEvent.click(within(quickView).getByRole("button", { name: "Book Now" }));
    await waitFor(() => expect(acquireMyGuestRoomHold).toHaveBeenCalledOnce());
    fireEvent.click(within(quickView).getByRole("button", { name: "Close" }));

    resolveAcquire({ expires_at: "2026-11-14T22:17:00Z" });

    await waitFor(() => expect(releaseMyGuestRoomHold).toHaveBeenCalledOnce());
    expect(screen.queryByRole("heading", { name: "Terms & Agreement" })).toBeNull();
  });
});
