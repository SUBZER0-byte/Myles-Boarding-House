import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    room_type: "Single",
    capacity: 1,
    monthly_rent: 1000,
    description: null,
    status: "Available",
    image: null,
    occupants: 0,
    available_beds: 1,
    available_for_dates: true,
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
    acquireMyGuestRoomHold.mockReset().mockResolvedValue({ expires_at: "2026-11-14T22:17:00Z" });
    releaseMyGuestRoomHold.mockReset().mockResolvedValue(null);
    getGuestBookingBoundaryDates.mockReset().mockResolvedValue({ room_id: room.room_id, dates: [] });
    refetchRooms.mockReset();
  });

  afterEach(() => cleanup());

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
