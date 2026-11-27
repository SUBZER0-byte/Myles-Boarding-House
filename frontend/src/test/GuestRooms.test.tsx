import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { addDays, format } from "date-fns";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const {
  acquireMyGuestRoomHold,
  createMyGuestBooking,
  releaseMyGuestRoomHold,
  getGuestBookingBoundaryDates,
  refetchRooms,
  room,
  roomList,
  boundaryDates,
  dashboardRange,
  guestGender,
  bookingPaymentDialog,
} = vi.hoisted(() => ({
  acquireMyGuestRoomHold: vi.fn(),
  createMyGuestBooking: vi.fn(),
  releaseMyGuestRoomHold: vi.fn(),
  getGuestBookingBoundaryDates: vi.fn(),
  refetchRooms: vi.fn(),
  boundaryDates: { room_id: 1, dates: [] as string[] },
  dashboardRange: { value: null as { checkInDate: string; checkOutDate: string } | null },
  guestGender: { value: null as string | null },
  bookingPaymentDialog: { props: null as Record<string, unknown> | null },
  room: {
    room_id: 1,
    room_number: "11",
    floor_number: 1,
    capacity: 1,
    monthly_rent: 1000,
    description: "Quiet room with a garden view",
    status: "Available",
    image: null,
    occupants: 0,
    occupant_genders: [],
    available_beds: 1,
    available_for_dates: true,
    has_active_booking: false,
    reservation_count: 0,
    reservation_deadlines_epoch: [] as number[],
    reservation_server_now_epoch: Math.floor(Date.now() / 1000),
  },
  roomList: { value: [] as Array<Record<string, unknown>> },
}));

vi.mock("@/components/DashboardLayout", () => ({
  DashboardLayout: ({
    children,
    roomAvailabilityRange,
  }: {
    children: ReactNode;
    roomAvailabilityRange?: { checkInDate: string; checkOutDate: string } | null;
  }) => {
    dashboardRange.value = roomAvailabilityRange ?? null;
    return <div>{children}</div>;
  },
}));
vi.mock("@/components/GuestRoomPhotoSlideshow", () => ({
  GuestRoomPhotoSlideshow: () => null,
}));
vi.mock("@/components/BookingPaymentDialog", () => ({
  BookingPaymentDialog: (props: Record<string, unknown>) => {
    bookingPaymentDialog.props = props;
    return null;
  },
}));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));
vi.mock("@/hooks/useSupabasePolling", () => ({
  useSupabasePolling: (_load: unknown, interval: number) => ({
    data: interval === 10000 ? (roomList.value.length ? roomList.value : [room]) : boundaryDates,
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
      gender: guestGender.value,
    }),
  },
}));
vi.mock("@/lib/guestBookings", () => ({
  acquireMyGuestRoomHold,
  createMyGuestBooking,
  getGuestBookingBoundaryDates,
  releaseMyGuestRoomHold,
  submitMyBookingInitialPayment: vi.fn(),
}));
vi.mock("@/lib/publicRooms", () => ({
  getCurrentPhilippineDate: () => new Date().toISOString().slice(0, 10),
  getPublicRoomsForDates: vi.fn(),
  isRoomGenderCompatible: (
    occupantGenders: string[] | undefined,
    guestGender: string | null,
  ) => {
    const firstKnownOccupantGender = occupantGenders?.find(
      (gender) => gender === "Male" || gender === "Female",
    );
    return !firstKnownOccupantGender || !guestGender || firstKnownOccupantGender === guestGender;
  },
}));
vi.mock("@/lib/savedRooms", () => ({
  readSavedRoomIds: () => [],
  writeSavedRoomIds: vi.fn(),
}));

import GuestRooms from "@/pages/guest/GuestRooms";

describe("GuestRooms temporary hold cancellation", () => {
  const originalScrollIntoView = Element.prototype.scrollIntoView;

  beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  beforeEach(() => {
    Object.assign(room, {
      status: "Available",
      capacity: 1,
      monthly_rent: 1000,
      description: "Quiet room with a garden view",
      occupant_genders: [],
      available_beds: 1,
      available_for_dates: true,
      has_active_booking: false,
      reservation_count: 0,
      reservation_deadlines_epoch: [],
      reservation_server_now_epoch: Math.floor(Date.now() / 1000),
    });
    acquireMyGuestRoomHold.mockReset().mockResolvedValue({ expires_at: "2026-11-14T22:17:00Z" });
    createMyGuestBooking.mockReset().mockResolvedValue({
      booking_id: 1,
      initial_payment_amount: 1000,
      payment_expires_at_epoch: 0,
      server_now_epoch: 0,
    });
    releaseMyGuestRoomHold.mockReset().mockResolvedValue(null);
    getGuestBookingBoundaryDates.mockReset().mockResolvedValue({ room_id: room.room_id, dates: [] });
    boundaryDates.room_id = room.room_id;
    boundaryDates.dates = [];
    refetchRooms.mockReset();
    dashboardRange.value = null;
    guestGender.value = null;
    bookingPaymentDialog.props = null;
    roomList.value = [];
  });

  afterEach(() => cleanup());
  afterAll(() => {
    Element.prototype.scrollIntoView = originalScrollIntoView;
  });

  it("shares the Browse Rooms date window with the chatbot", async () => {
    const checkInDate = new Date().toISOString().slice(0, 10);
    const checkOutDate = new Date(`${checkInDate}T00:00:00`);
    checkOutDate.setDate(checkOutDate.getDate() + 1);

    render(<GuestRooms />);

    expect(dashboardRange.value).toEqual({
      checkInDate,
      checkOutDate: format(checkOutDate, "yyyy-MM-dd"),
    });
  });

  it("shows the current database room status in the room card and quick view", async () => {
    room.status = "Occupied";
    render(<GuestRooms />);

    expect(await screen.findByText("Occupied")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Quick view" }));
    expect(within(screen.getByRole("dialog")).getByText("Occupied")).toBeTruthy();
  });

  it("filters Browse Rooms by room number and description and can clear the filters", async () => {
    render(<GuestRooms />);

    fireEvent.click(screen.getByRole("combobox", { name: "Filter by room number" }));
    fireEvent.click(await screen.findByRole("option", { name: "Room 11" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Description" }), {
      target: { value: "GARDEN" },
    });

    expect(screen.getByRole("status")).toHaveTextContent("Showing 1 of 1 room");
    expect(await screen.findByRole("button", { name: "Book Now" })).toBeTruthy();

    fireEvent.change(screen.getByRole("searchbox", { name: "Description" }), {
      target: { value: "not present" },
    });

    expect(await screen.findByText("No rooms match your selected filters.")).toBeTruthy();
    expect(screen.getByRole("status")).toHaveTextContent("Showing 0 of 1 room");
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(await screen.findByRole("button", { name: "Book Now" })).toBeTruthy();
  });

  it("shows active room reservations and their countdown in Browse Rooms", async () => {
    room.reservation_count = 1;
    room.reservation_deadlines_epoch = [Math.floor(Date.now() / 1000) + 3600];
    room.reservation_server_now_epoch = Math.floor(Date.now() / 1000);
    render(<GuestRooms />);

    expect(await screen.findByText("Reserved by 1 guest")).toBeTruthy();
    expect(screen.getByText(/Next expires in 1h/)).toBeTruthy();
  });

  it("shows the current occupant gender in Browse Rooms and its quick view", async () => {
    guestGender.value = "Female";
    room.occupant_genders = ["Female"];
    render(<GuestRooms />);

    expect(await screen.findByText("Registered occupant gender(s): Female")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Quick view" }));
    expect(within(screen.getByRole("dialog")).getByText("Registered occupant gender(s): Female")).toBeTruthy();
  });

  it("shows all rooms but prevents booking when the first known occupant is the opposite gender", async () => {
    guestGender.value = "Male";
    room.occupant_genders = ["Female"];
    render(<GuestRooms />);

    expect(await screen.findByText("Room 11")).toBeTruthy();
    expect(screen.getByText("This room is assigned to the opposite gender and cannot be booked by your account."))
      .toBeTruthy();
    expect(screen.getByRole("status")).toHaveTextContent("Showing 1 of 1 room");
    expect(screen.getByRole("button", { name: "Gender restricted" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Quick view" }));
    const quickView = screen.getByRole("dialog");
    expect(within(quickView).getByRole("button", { name: "Gender restricted" })).toBeDisabled();
  });

  it("displays all 16 database rooms, including rooms restricted by gender", async () => {
    guestGender.value = "Male";
    roomList.value = Array.from({ length: 16 }, (_, index) => ({
      ...room,
      room_id: index + 1,
      room_number: String(index + 1),
      occupant_genders: index % 2 === 0 ? ["Male"] : ["Female"],
    }));
    render(<GuestRooms />);

    expect(await screen.findByText("Room 1")).toBeTruthy();
    expect(screen.getByText("Room 16")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Quick view" })).toHaveLength(16);
    expect(screen.getAllByRole("button", { name: "Gender restricted" })).toHaveLength(8);
  });

  it("records the selected relationship in the booking notes", async () => {
    guestGender.value = "Male";
    render(<GuestRooms />);

    fireEvent.click(await screen.findByRole("button", { name: "Book Now" }));
    await screen.findByRole("heading", { name: "Terms & Agreement" });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Agree & Continue" }));
    await screen.findByRole("heading", { name: "Booking Details" });

    fireEvent.change(screen.getByLabelText("Connection to a tenant of the opposite gender (if applicable)"), {
      target: { value: "Girlfriend" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Select move-in date" }));
    const moveInDate = new Date();
    moveInDate.setHours(0, 0, 0, 0);
    fireEvent.click(screen.getByRole("gridcell", { name: String(moveInDate.getDate()) }));
    fireEvent.click(screen.getByRole("button", { name: "Continue to Payment Plan" }));
    await screen.findByText(/Estimated rent for 1 person:/);
    fireEvent.click(screen.getByRole("button", { name: "Review Booking" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm Booking" }));

    await waitFor(() => expect(createMyGuestBooking).toHaveBeenCalledWith(
      expect.objectContaining({
        notes: "Connection to an opposite-gender tenant: Girlfriend",
      }),
    ));
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

    const moveOutDate = addDays(moveInDate, 90);
    expect(screen.getByLabelText("Move-out Date (calculated)")).toHaveProperty(
      "value",
      format(moveOutDate, "PPP"),
    );
  });

  it("disables a move-in date already scheduled in the database", async () => {
    const occupiedDate = new Date();
    occupiedDate.setHours(0, 0, 0, 0);
    occupiedDate.setDate(occupiedDate.getDate() + 5);
    boundaryDates.dates = [format(occupiedDate, "yyyy-MM-dd")];
    render(<GuestRooms />);

    fireEvent.click(await screen.findByRole("button", { name: "Book Now" }));
    await screen.findByRole("heading", { name: "Terms & Agreement" });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Agree & Continue" }));
    await screen.findByRole("heading", { name: "Booking Details" });
    fireEvent.click(screen.getByRole("button", { name: "Select move-in date" }));

    const occupiedDay = screen.getByRole("gridcell", { name: String(occupiedDate.getDate()) });
    expect(occupiedDay).toBeDisabled();
    fireEvent.click(occupiedDay);
    expect(screen.getByRole("button", { name: "Select move-in date" })).toBeTruthy();
  });

  it("requires a one-month deposit and advance for one-month stays", async () => {
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
    fireEvent.click(screen.getByRole("button", { name: "Continue to Payment Plan" }));

    expect(await screen.findByText(/Estimated rent for 1 person:/)).toHaveTextContent("₱1,000");
    const bookingDialog = screen.getByRole("dialog");
    const paymentPlan = within(bookingDialog).getByRole("combobox");
    expect(within(bookingDialog).getByRole("option", { name: "Monthly rent payments" })).toBeTruthy();
    expect(within(bookingDialog).queryByRole("option", { name: "Monthly rent payments with deposit applied to the final month" })).toBeNull();
    expect(paymentPlan).toHaveValue("Pay One Month Rent");
    expect(within(bookingDialog).getByText(/Payment required today:/)).toHaveTextContent("₱2,000");
    expect(within(bookingDialog).getByText(/One-month security deposit \(included today\):/)).toHaveTextContent("₱1,000");
    expect(within(bookingDialog).getByText(/One-month advance rent \(included today\):/)).toHaveTextContent("₱1,000");
    expect(within(bookingDialog).getByText(/Remaining rent after first 30 days:/)).toHaveTextContent("₱0");
    fireEvent.click(within(bookingDialog).getByRole("button", { name: "Review Booking" }));

    expect(within(bookingDialog).getByText(/Payment required today:/)).toHaveTextContent("₱2,000");
    expect(within(bookingDialog).getByText(/security deposit \(included today\):/)).toHaveTextContent("₱1,000");
    expect(within(bookingDialog).getByText(/Remaining rent for 0 months:/)).toHaveTextContent("₱0");
    fireEvent.click(within(bookingDialog).getByRole("button", { name: "Confirm Booking" }));
    await waitFor(() => expect(bookingPaymentDialog.props).toMatchObject({
      open: true,
      amountPHP: 2000,
    }));
  });

  it("calculates the same deposit and advance for longer stays", async () => {
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

    expect(await screen.findByText(/Estimated rent for 1 person:/)).toHaveTextContent("₱2,000");
    const bookingDialog = screen.getByRole("dialog");
    const paymentPlan = within(bookingDialog).getByRole("combobox");
    expect(within(bookingDialog).getByRole("option", { name: "Monthly rent payments with deposit covering the first 30 days" })).toBeTruthy();
    fireEvent.change(paymentPlan, { target: { value: "Pay Monthly" } });
    expect(within(bookingDialog).getByText(/Payment required today:/)).toHaveTextContent("₱2,000");
    expect(within(bookingDialog).getByText(/One-month security deposit \(included today\):/)).toHaveTextContent("₱1,000");
    expect(within(bookingDialog).getByText(/One-month advance rent \(included today\):/)).toHaveTextContent("₱1,000");
    expect(within(bookingDialog).getByText(/Remaining rent after first 30 days:/)).toHaveTextContent("₱1,000");
    fireEvent.click(screen.getByRole("button", { name: "Review Booking" }));

    expect(within(bookingDialog).getByText(/Monthly rent per person:/).parentElement).toHaveTextContent("₱1,000");
    expect(within(bookingDialog).getByText(/Total rent for 1 person:/).parentElement).toHaveTextContent("₱2,000");
    expect(within(bookingDialog).getByText(/Plan:/).parentElement).toHaveTextContent("Monthly rent with deposit covering the first 30 days");
    expect(within(bookingDialog).getByText(/Payment required today:/)).toHaveTextContent("₱2,000");
    expect(within(bookingDialog).getByText(/security deposit \(included today\):/)).toHaveTextContent("₱1,000");
    expect(within(bookingDialog).getByText(/Remaining rent for 1 month:/)).toHaveTextContent("₱1,000");
    fireEvent.click(within(bookingDialog).getByRole("button", { name: "Confirm Booking" }));
    await waitFor(() => expect(createMyGuestBooking).toHaveBeenCalledOnce());
    expect(createMyGuestBooking).toHaveBeenCalledWith(
      expect.objectContaining({ payment_plan: "Pay Monthly" }),
    );
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
