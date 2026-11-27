import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { format } from "date-fns";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { room, pollState, requestStayExtension, refetchRoom } = vi.hoisted(() => ({
  room: {
    room_id: 4,
    tenant_id: 8,
    room_number: "204",
    floor_number: 2,
    capacity: 2,
    monthly_rent: 6500,
    status: "Occupied",
    description: null,
    move_in_date: "2026-12-31",
    move_out_date: "2027-01-31",
    check_out_date: "2027-01-31",
    requested_move_out_date: null,
    extension_request_status: null,
    available_advance_amount: 6500,
    tenant_name: "Test Tenant",
    roommates: [],
  },
  pollState: { count: 0 },
  requestStayExtension: vi.fn(),
  refetchRoom: vi.fn(),
}));

vi.mock("@/components/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/useSupabasePolling", () => ({
  useSupabasePolling: () => {
    const isRoomPoll = pollState.count % 2 === 0;
    pollState.count += 1;
    return {
      data: isRoomPoll ? room : [],
      error: null,
      refetch: refetchRoom,
    };
  },
}));
vi.mock("@/lib/api", () => ({
  sessionStore: { get: () => ({ user_id: 8 }) },
}));
vi.mock("@/lib/tenantRoom", () => ({
  getAvailableTenantRooms: vi.fn(),
  getMyTenantRoom: vi.fn(),
}));
vi.mock("@/lib/stayExtensions", () => ({ requestStayExtension }));
vi.mock("@/lib/tenantRequests", () => ({
  createTenantRoomChangeRequest: vi.fn(),
}));

import TenantRoom from "@/pages/tenant/TenantRoom";

describe("TenantRoom stay extension", () => {
  beforeEach(() => {
    pollState.count = 0;
    requestStayExtension.mockReset().mockResolvedValue("Request submitted.");
    refetchRoom.mockReset();
  });

  it("calculates the new move-out date from the current checkout and submits it", async () => {
    render(<TenantRoom />);
    fireEvent.click(screen.getByRole("button", { name: "Request to Extend Stay" }));

    expect(screen.getByText(/Available booking advance applied to the first extension month:/))
      .toHaveTextContent("−₱6,500");
    expect(screen.getByText(/New one-month advance required after approval:/))
      .toHaveTextContent("₱6,500");

    const monthsInput = screen.getByLabelText("Extension length (months)");
    expect(screen.getByLabelText("New move-out date (calculated)")).toHaveValue(
      format(new Date("2027-02-28T00:00:00"), "PPP"),
    );

    fireEvent.change(monthsInput, { target: { value: "2" } });
    expect(screen.getByLabelText("New move-out date (calculated)")).toHaveValue(
      format(new Date("2027-03-31T00:00:00"), "PPP"),
    );

    fireEvent.click(screen.getByRole("button", { name: "Submit Request" }));
    await waitFor(() => expect(requestStayExtension).toHaveBeenCalledWith("2027-03-31"));
  });

  it("disables submission when the extension length is empty", () => {
    render(<TenantRoom />);
    fireEvent.click(screen.getByRole("button", { name: "Request to Extend Stay" }));
    fireEvent.change(screen.getByLabelText("Extension length (months)"), {
      target: { value: "" },
    });

    expect(screen.getByLabelText("New move-out date (calculated)")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Submit Request" })).toBeDisabled();
  });
});
