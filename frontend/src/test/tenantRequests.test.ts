import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke, rpc, getUser, upload, remove, createSignedUrls, storageFrom } = vi.hoisted(() => {
  const upload = vi.fn();
  const remove = vi.fn();
  const createSignedUrls = vi.fn();
  return {
    invoke: vi.fn(),
    rpc: vi.fn(),
    getUser: vi.fn(),
    upload,
    remove,
    createSignedUrls,
    storageFrom: vi.fn(() => ({ upload, remove, createSignedUrls })),
  };
});

vi.mock("@/lib/supabase", () => ({
  supabase: {
    functions: { invoke },
    rpc,
    auth: { getUser },
    storage: { from: storageFrom },
  },
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
    rpc.mockReset().mockResolvedValue({ data: [], error: null });
    getUser.mockReset().mockResolvedValue({ data: { user: { id: "tenant-auth-id" } }, error: null });
    upload.mockReset().mockResolvedValue({ data: { path: "uploaded-path" }, error: null });
    remove.mockReset().mockResolvedValue({ data: [], error: null });
    createSignedUrls.mockReset().mockResolvedValue({ data: [], error: null });
    storageFrom.mockClear();
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
    });
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

  it("uploads multiple images and an optional video and associates them with the created complaint", async () => {
    invoke.mockResolvedValue({ data: { type: "success", complaint_id: 21 }, error: null });
    rpc.mockResolvedValue({ data: { type: "success" }, error: null });
    const imageOne = new File(["image-one"], "room.jpg", { type: "image/jpeg" });
    const imageTwo = new File(["image-two"], "leak.png", { type: "image/png" });
    const video = new File(["video"], "leak.mp4", { type: "video/mp4" });

    await createTenantComplaint({
      title: "Leaking pipe",
      description: "Water is dripping.",
      category: "Plumbing",
      is_urgent: false,
    }, [
      { file: imageOne, type: "image" },
      { file: imageTwo, type: "image" },
      { file: video, type: "video" },
    ]);

    expect(upload).toHaveBeenCalledTimes(3);
    expect(rpc).toHaveBeenCalledWith("attach_tenant_complaint_attachments", {
      p_complaint_id: 21,
      p_attachments: [
        expect.objectContaining({ type: "image", sort_order: 0 }),
        expect.objectContaining({ type: "image", sort_order: 1 }),
        expect.objectContaining({ type: "video", sort_order: 2 }),
      ],
    });
  });

  it("rejects more than five images before uploading or filing", async () => {
    const images = Array.from({ length: 6 }, (_, index) => ({
      file: new File([`image-${index}`], `room-${index}.jpg`, { type: "image/jpeg" }),
      type: "image" as const,
    }));

    await expect(createTenantComplaint({
      title: "Leaking pipe",
      description: "Water is dripping.",
      category: "Plumbing",
      is_urgent: false,
    }, images)).rejects.toThrow("Attach up to five images and one optional video.");
    expect(upload).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("cleans up uploaded files and reports when attachment association fails after filing", async () => {
    invoke.mockResolvedValue({ data: { type: "success", complaint_id: 22 }, error: null });
    rpc.mockResolvedValue({ data: null, error: { message: "Migration is not applied." } });
    const image = new File(["image"], "room.jpg", { type: "image/jpeg" });

    await expect(createTenantComplaint({
      title: "Leaking pipe",
      description: "Water is dripping.",
      category: "Plumbing",
      is_urgent: false,
    }, [{ file: image, type: "image" }])).rejects.toThrow(
      "Complaint #22 was filed, but its attachments could not be saved: Migration is not applied.",
    );
    expect(remove).toHaveBeenCalledWith(expect.arrayContaining([
      expect.stringMatching(/^tenant-auth-id\/.+\.jpg$/),
    ]));
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

  it("returns every Admin complaint and signs each complaint's attachments", async () => {
    const complaints = [
      { complaint_id: 8, title: "Leaking pipe" },
      { complaint_id: 9, title: "Broken light" },
    ];
    const attachmentPath = "tenant-auth-id/complaint.jpg";
    invoke.mockResolvedValue({ data: { type: "success", data: complaints }, error: null });
    rpc.mockResolvedValue({
      data: [{
        attachment_id: 1,
        complaint_id: 8,
        path: attachmentPath,
        type: "image",
        sort_order: 0,
      }],
      error: null,
    });
    createSignedUrls.mockResolvedValue({
      data: [{ path: attachmentPath, signedUrl: "https://signed.example/complaint.jpg", error: null }],
      error: null,
    });

    const result = await listAdminComplaints();

    expect(result).toHaveLength(2);
    expect(result[0].attachments).toEqual([expect.objectContaining({
      path: attachmentPath,
      signed_url: "https://signed.example/complaint.jpg",
    })]);
    expect(result[1].attachments).toEqual([]);
  });

  it("surfaces API errors instead of treating a failed request as success", async () => {
    invoke.mockResolvedValue({ data: { type: "error", message: "Only submitted complaints can be cancelled." }, error: null });

    await expect(cancelTenantComplaint(8)).rejects.toThrow("Only submitted complaints can be cancelled.");
  });
});
