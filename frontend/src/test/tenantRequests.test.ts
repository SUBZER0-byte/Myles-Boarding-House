import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke } },
}));

import {
  cancelTenantComplaint,
  createTenantComplaint,
  createTenantRoomChangeRequest,
  listAdminComplaints,
  listTenantComplaints,
  updateComplaintStatus,
} from "@/lib/tenantRequests";

describe("tenant request workflows", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it("loads the current tenant complaint list without a user ID", async () => {
    const complaints = [{ complaint_id: 8, title: "Leaking pipe" }];
    invoke.mockResolvedValue({ data: { type: "success", data: complaints }, error: null });

    await expect(listTenantComplaints()).resolves.toEqual(complaints);
    expect(invoke).toHaveBeenCalledWith("tenant-requests", {
      body: { action: "tenant_list_complaints", data: {} },
    });
  });

  it("creates complaint data without accepting a browser-provided tenant ID", async () => {
    invoke.mockResolvedValue({ data: { type: "success", complaint_id: 8 }, error: null });

    await createTenantComplaint({
      title: "Leaking pipe",
      description: "Water is dripping.",
      category: "Plumbing",
      is_urgent: false,
    }, null);
    expect(invoke).toHaveBeenCalledWith("tenant-requests", {
      body: {
        action: "tenant_create_complaint",
        data: {
          title: "Leaking pipe",
          description: "Water is dripping.",
          category: "Plumbing",
          is_urgent: false,
          photo_path: null,
        },
      },
    });
  });

  it("creates a room-change request without accepting a browser-provided tenant ID", async () => {
    invoke.mockResolvedValue({
      data: { type: "success", message: "Request submitted." },
      error: null,
    });

    await expect(createTenantRoomChangeRequest(3, "Closer to the kitchen")).resolves.toBe("Request submitted.");
    expect(invoke).toHaveBeenCalledWith("tenant-requests", {
      body: {
        action: "tenant_create_room_change",
        data: { requested_room_id: 3, reason: "Closer to the kitchen" },
      },
    });
  });

  it("updates complaint status through the Admin-only request action", async () => {
    invoke.mockResolvedValue({ data: { type: "success" }, error: null });

    await updateComplaintStatus(8, "Resolved");
    expect(invoke).toHaveBeenCalledWith("tenant-requests", {
      body: { action: "admin_update_complaint_status", data: { complaint_id: 8, status: "Resolved" } },
    });
  });

  it("uses the same role-checked service for Admin reads and Tenant cancellation", async () => {
    invoke.mockResolvedValue({ data: { type: "success", data: [] }, error: null });
    await listAdminComplaints();
    await cancelTenantComplaint(8);
    expect(invoke).toHaveBeenNthCalledWith(1, "tenant-requests", {
      body: { action: "admin_list_complaints", data: {} },
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "tenant-requests", {
      body: { action: "tenant_cancel_complaint", data: { complaint_id: 8 } },
    });
  });

  it("surfaces API errors instead of treating a failed request as success", async () => {
    invoke.mockResolvedValue({ data: { type: "error", message: "Only submitted complaints can be cancelled." }, error: null });

    await expect(cancelTenantComplaint(8)).rejects.toThrow("Only submitted complaints can be cancelled.");
  });
});
