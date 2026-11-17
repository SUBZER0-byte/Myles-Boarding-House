import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RoomDisplayData } from "@/components/RoomCard";

vi.mock("@/components/GuestRoomPhotoSlideshow", () => ({
  GuestRoomPhotoSlideshow: ({ roomNumber }: { roomNumber: string }) => (
    <div aria-label={`Photos for room ${roomNumber}`} />
  ),
}));

import { RoomCard } from "@/components/RoomCard";
import { RoomDetailsDialog } from "@/components/RoomDetailsDialog";

const room: RoomDisplayData = {
  room_id: 17,
  room_number: "17",
  room_type: "Double",
  image: "/room-17.jpg",
  monthly_rent: 4500,
  status: "Occupied",
  capacity: 2,
  available_beds: 1,
  description: "Two-bed room near the common kitchen.",
};

describe("Landing page room display", () => {
  it("shows the live status and availability with View Details but no booking action", () => {
    render(<RoomCard room={room} onView={vi.fn()} />);

    expect(screen.getByText("Occupied")).toBeTruthy();
    expect(screen.getByText("1 bedspace(s) available")).toBeTruthy();
    expect(screen.getByText("Two-bed room near the common kitchen.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "View Details" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /book/i })).toBeNull();
  });

  it("shows current room data in the details dialog without a booking button", () => {
    render(<RoomDetailsDialog room={room} open onOpenChange={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "Room 17" })).toBeTruthy();
    expect(screen.getByText("Occupied")).toBeTruthy();
    expect(screen.getByRole("dialog").textContent).toContain("₱4,500/month");
    expect(screen.getByText("Capacity: 2")).toBeTruthy();
    expect(screen.getByText("Two-bed room near the common kitchen.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /book/i })).toBeNull();
  });
});
