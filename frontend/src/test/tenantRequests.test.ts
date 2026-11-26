import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke, rpc, getUser, getSession, upload, remove, createSignedUrls, storageFrom, startTusUpload } = vi.hoisted(() => {
  const upload = vi.fn();
  const remove = vi.fn();
  const createSignedUrls = vi.fn();
  return {
    invoke: vi.fn(),
    rpc: vi.fn(),
    getUser: vi.fn(),
    getSession: vi.fn(),
    upload,
    remove,
    createSignedUrls,
    storageFrom: vi.fn(() => ({ upload, remove, createSignedUrls })),
    startTusUpload: vi.fn(),
  };
});

vi.mock("@/lib/supabase", () => ({
  SUPABASE_URL: "https://sxrwgoqzlwseqadozcwl.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
  supabase: {
    functions: { invoke },
    rpc,
    auth: { getUser, getSession },
    storage: { from: storageFrom },
  },
}));

vi.mock("tus-js-client", () => ({
  Upload: class {
    constructor(
      private file: File,
      private options: {
        onProgress: (bytesUploaded: number, bytesTotal: number) => void;
        onSuccess: () => void;
      },
    ) {}

    start() {
      startTusUpload(this.file, this.options);
    }
  },
}));

import {
  cancelTenantComplaint,
  createTenantComplaint,
  createTenantMaintenanceRequest,
  createTenantRoomChangeRequest,
  deleteMaintenanceRequest,
  listAdminMaintenanceRequests,
  listAdminComplaints,
  listTenantComplaints,
  MAX_REQUEST_IMAGE_SIZE_BYTES,
  MAX_REQUEST_VIDEO_SIZE_BYTES,
  updateComplaintStatus,
} from "@/lib/tenantRequests";

describe("tenant request workflows", () => {
  beforeEach(() => {
    invoke.mockReset();
    rpc.mockReset().mockResolvedValue({ data: [], error: null });
    getUser.mockReset().mockResolvedValue({ data: { user: { id: "tenant-auth-id" } }, error: null });
    getSession.mockReset().mockResolvedValue({
      data: { session: { access_token: "tenant-access-token" } },
      error: null,
    });
    upload.mockReset().mockResolvedValue({ data: { path: "uploaded-path" }, error: null });
    startTusUpload.mockReset().mockImplementation((
      file: File,
      options: {
        onProgress: (bytesUploaded: number, bytesTotal: number) => void;
        onSuccess: () => void;
      },
    ) => {
      options.onProgress(file.size / 2, file.size);
      options.onSuccess();
    });
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

  it("uses direct-host resumable uploads with progress for large evidence files", async () => {
    invoke.mockResolvedValue({ data: { type: "success", complaint_id: 25 }, error: null });
    rpc.mockResolvedValue({ data: { type: "success" }, error: null });
    const video = new File(["video"], "recording.mp4", { type: "video/mp4" });
    Object.defineProperty(video, "size", { value: 10 * 1024 * 1024 });
    const progress: number[] = [];

    await createTenantComplaint({
      title: "Leak",
      description: "Video evidence",
      category: "Plumbing",
      is_urgent: false,
    }, [{ file: video, type: "video" }], value => progress.push(value));

    expect(upload).not.toHaveBeenCalled();
    expect(getSession).toHaveBeenCalledOnce();
    expect(startTusUpload).toHaveBeenCalledOnce();
    const options = startTusUpload.mock.calls[0][1];
    expect(options.endpoint).toBe("https://sxrwgoqzlwseqadozcwl.storage.supabase.co/storage/v1/upload/resumable");
    expect(options.chunkSize).toBe(6 * 1024 * 1024);
    expect(options.headers).toEqual({
      authorization: "Bearer tenant-access-token",
      apikey: "test-publishable-key",
    });
    expect(options.metadata).toEqual(expect.objectContaining({
      bucketName: "mbh-request-photos",
      contentType: "video/mp4",
    }));
    expect(progress).toEqual([50, 100]);
  });

  it("allows videos up to 500MB and rejects larger videos for complaints and maintenance", async () => {
    const makeVideo = (size: number) => {
      const file = new File(["video"], "recording.mp4", { type: "video/mp4" });
      Object.defineProperty(file, "size", { value: size });
      return file;
    };
    const allowedVideo = makeVideo(MAX_REQUEST_VIDEO_SIZE_BYTES);
    const oversizedVideo = makeVideo(MAX_REQUEST_VIDEO_SIZE_BYTES + 1);
    invoke
      .mockResolvedValueOnce({ data: { type: "success", complaint_id: 23 }, error: null })
      .mockResolvedValueOnce({ data: { type: "success", request_id: 32 }, error: null });
    rpc.mockResolvedValue({ data: { type: "success" }, error: null });

    await expect(createTenantComplaint({
      title: "Leak",
      description: "Video evidence",
      category: "Plumbing",
      is_urgent: false,
    }, [{ file: allowedVideo, type: "video" }])).resolves.toMatchObject({
      type: "success",
    });
    await expect(createTenantMaintenanceRequest({
      title: "Leaking sink",
      description: "Video evidence",
      category: "Plumbing",
      priority: "High",
    }, [{ file: allowedVideo, type: "video" }])).resolves.toBeUndefined();
    await expect(createTenantComplaint({
      title: "Leak",
      description: "Oversized video",
      category: "Plumbing",
      is_urgent: false,
    }, [{ file: oversizedVideo, type: "video" }]))
      .rejects.toThrow("500MB or smaller");
    await expect(createTenantMaintenanceRequest({
      title: "Leaking sink",
      description: "Oversized video",
      category: "Plumbing",
      priority: "High",
    }, [{ file: oversizedVideo, type: "video" }]))
      .rejects.toThrow("500MB or smaller");
    await expect(createTenantComplaint({
      title: "Leak",
      description: "Video evidence",
      category: "Plumbing",
      is_urgent: false,
    }, [{ file: makeVideo(0), type: "video" }]))
      .rejects.toThrow("Video must be MP4, WEBM, or MOV and 500MB or smaller.");

    expect(startTusUpload).toHaveBeenCalledTimes(2);
    expect(upload).not.toHaveBeenCalled();
  });

  it("allows complaint and maintenance images up to 100MB per file", async () => {
    const makeImage = (size: number) => {
      const file = new File(["image"], "evidence.png", { type: "image/png" });
      Object.defineProperty(file, "size", { value: size });
      return file;
    };
    invoke
      .mockResolvedValueOnce({ data: { type: "success", complaint_id: 24 }, error: null })
      .mockResolvedValueOnce({ data: { type: "success", request_id: 33 }, error: null });
    rpc.mockResolvedValue({ data: { type: "success" }, error: null });

    await createTenantComplaint({
      title: "Leak",
      description: "Image evidence",
      category: "Plumbing",
      is_urgent: false,
    }, [{ file: makeImage(MAX_REQUEST_IMAGE_SIZE_BYTES), type: "image" }]);
    await createTenantMaintenanceRequest({
      title: "Leaking sink",
      description: "Image evidence",
      category: "Plumbing",
      priority: "High",
    }, [{ file: makeImage(MAX_REQUEST_IMAGE_SIZE_BYTES), type: "image" }]);
    await expect(createTenantComplaint({
      title: "Leak",
      description: "Oversized image",
      category: "Plumbing",
      is_urgent: false,
    }, [{ file: makeImage(MAX_REQUEST_IMAGE_SIZE_BYTES + 1), type: "image" }]))
      .rejects.toThrow("100MB or smaller");

    expect(startTusUpload).toHaveBeenCalledTimes(2);
    expect(upload).not.toHaveBeenCalled();
  });

  it("uploads multiple images and an optional video for maintenance requests", async () => {
    invoke.mockResolvedValue({ data: { type: "success", request_id: 31 }, error: null });
    rpc.mockResolvedValue({ data: { type: "success" }, error: null });
    const image = new File(["image"], "sink.jpg", { type: "image/jpeg" });
    const video = new File(["video"], "leak.mp4", { type: "video/mp4" });

    await createTenantMaintenanceRequest({
      title: "Leaking sink",
      description: "Water is leaking below the sink.",
      category: "Plumbing",
      priority: "High",
    }, [
      { file: image, type: "image" },
      { file: video, type: "video" },
    ]);

    expect(invoke).toHaveBeenCalledWith("tenant-requests", {
      body: {
        action: "tenant_create_maintenance",
        data: {
          title: "Leaking sink",
          description: "Water is leaking below the sink.",
          category: "Plumbing",
          priority: "High",
          photo_path: null,
        },
      },
    });
    expect(rpc).toHaveBeenCalledWith("attach_tenant_maintenance_attachments", {
      p_request_id: 31,
      p_attachments: [
        expect.objectContaining({ type: "image", sort_order: 0 }),
        expect.objectContaining({ type: "video", sort_order: 1 }),
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

  it("signs and returns maintenance attachments for Admin requests", async () => {
    const attachmentPath = "tenant-auth-id/maintenance.jpg";
    invoke.mockResolvedValue({
      data: { type: "success", data: [{ request_id: 7, title: "Leaking sink" }] },
      error: null,
    });
    rpc.mockResolvedValue({
      data: [{
        attachment_id: 3,
        request_id: 7,
        path: attachmentPath,
        type: "image",
        sort_order: 0,
      }],
      error: null,
    });
    createSignedUrls.mockResolvedValue({
      data: [{ path: attachmentPath, signedUrl: "https://signed.example/maintenance.jpg", error: null }],
      error: null,
    });

    const result = await listAdminMaintenanceRequests();

    expect(result[0].attachments).toEqual([expect.objectContaining({
      path: attachmentPath,
      signed_url: "https://signed.example/maintenance.jpg",
    })]);
  });

  it("removes maintenance media after an Admin deletes its request", async () => {
    invoke.mockResolvedValue({ data: { type: "success", message: "Deleted." }, error: null });
    const attachmentPath = "tenant-auth-id/maintenance.jpg";

    await expect(deleteMaintenanceRequest(7, [attachmentPath])).resolves.toBe("Deleted.");

    expect(remove).toHaveBeenCalledWith([attachmentPath]);
  });

  it("surfaces API errors instead of treating a failed request as success", async () => {
    invoke.mockResolvedValue({ data: { type: "error", message: "Only submitted complaints can be cancelled." }, error: null });

    await expect(cancelTenantComplaint(8)).rejects.toThrow("Only submitted complaints can be cancelled.");
  });
});
