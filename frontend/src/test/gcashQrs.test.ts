import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, upload, createSignedUrl, remove, from } = vi.hoisted(() => ({
  rpc: vi.fn(),
  upload: vi.fn(),
  createSignedUrl: vi.fn(),
  remove: vi.fn(),
  from: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc,
    storage: { from },
  },
}));

import {
  deleteAdminGcashQr,
  listAdminGcashQrs,
  listPublicGcashQrs,
  replaceAdminGcashQrImage,
  uploadAdminGcashQr,
} from "@/lib/gcashQrs";

const filename = "gcash-qr/ffe10000-0000-4000-8000-000000000001.png";

describe("Supabase GCash QR workflows", () => {
  beforeEach(() => {
    rpc.mockReset();
    upload.mockReset();
    createSignedUrl.mockReset();
    remove.mockReset();
    from.mockReset();
    from.mockReturnValue({ upload, createSignedUrl, remove });
    rpc.mockResolvedValue({
      data: {
        type: "success",
        data: [{ filename, amount: 2500, uploaded_at: 1700000000000, is_active: true }],
      },
      error: null,
    });
    upload.mockResolvedValue({ error: null });
    createSignedUrl.mockResolvedValue({
      data: { signedUrl: "https://storage.example/signed" },
      error: null,
    });
    remove.mockResolvedValue({ error: null });
  });

  it("loads Admin QR paths through the authorized RPC and signs them privately", async () => {
    await expect(listAdminGcashQrs()).resolves.toEqual([
      {
        filename,
        amount: 2500,
        uploaded_at: 1700000000000,
        is_active: true,
        path: "https://storage.example/signed",
      },
    ]);
    expect(rpc).toHaveBeenCalledWith("manage_gcash_qrs", {
      p_action: "admin_list",
      p_data: {},
    });
    expect(from).toHaveBeenCalledWith("mbh-payment-qrs");
    expect(createSignedUrl).toHaveBeenCalledWith(filename, 300);
  });

  it("loads payment QR images through the authenticated public-list action", async () => {
    await expect(listPublicGcashQrs()).resolves.toEqual([
      { path: "https://storage.example/signed", amount: 2500 },
    ]);
    expect(rpc).toHaveBeenCalledWith("manage_gcash_qrs", {
      p_action: "public_list",
      p_data: {},
    });
  });

  it("uploads a validated image before saving its amount and removes it if saving fails", async () => {
    const file = new File(["qr"], "qr.png", { type: "image/png" });
    await uploadAdminGcashQr(file, 2500);

    expect(upload).toHaveBeenCalledWith(
      expect.stringMatching(/^gcash-qr\/[0-9a-f-]+\.png$/),
      file,
      { contentType: "image/png", upsert: false },
    );
    expect(rpc).toHaveBeenCalledWith("manage_gcash_qrs", {
      p_action: "admin_upload",
      p_data: {
        filename: expect.stringMatching(/^gcash-qr\/[0-9a-f-]+\.png$/),
        amount: 2500,
      },
    });

    rpc.mockRejectedValueOnce(new Error("Database unavailable"));
    await expect(uploadAdminGcashQr(file, 4000)).rejects.toThrow("Database unavailable");
    expect(remove).toHaveBeenCalledWith([
      expect.stringMatching(/^gcash-qr\/[0-9a-f-]+\.png$/),
    ]);
  });

  it("rejects unsupported images and invalid amounts before touching Supabase", async () => {
    await expect(
      uploadAdminGcashQr(new File(["x"], "qr.gif", { type: "image/gif" }), 2500),
    ).rejects.toThrow("JPG, PNG, or WEBP");
    await expect(
      uploadAdminGcashQr(new File(["x"], "qr.png", { type: "image/png" }), 0),
    ).rejects.toThrow("valid fixed amount");
    expect(upload).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("deletes the database record before removing its Storage object", async () => {
    rpc.mockResolvedValueOnce({ data: { type: "success", data: null }, error: null });
    await expect(deleteAdminGcashQr(filename)).resolves.toEqual({});
    expect(rpc).toHaveBeenCalledWith("manage_gcash_qrs", {
      p_action: "admin_delete",
      p_data: { filename },
    });
    expect(remove).toHaveBeenCalledWith([filename]);
  });

  it("replaces a QR through the RPC and removes its previous Storage image", async () => {
    const file = new File(["cropped"], "qr.webp", { type: "image/webp" });
    rpc.mockResolvedValueOnce({ data: { type: "success", data: null }, error: null });

    await replaceAdminGcashQrImage(filename, file);

    expect(upload).toHaveBeenCalledWith(
      expect.stringMatching(/^gcash-qr\/[0-9a-f-]+\.webp$/),
      file,
      { contentType: "image/webp", upsert: false },
    );
    expect(rpc).toHaveBeenCalledWith("manage_gcash_qrs", {
      p_action: "admin_replace",
      p_data: {
        filename,
        replacement_path: expect.stringMatching(/^gcash-qr\/[0-9a-f-]+\.webp$/),
      },
    });
    expect(remove).toHaveBeenCalledWith([filename]);
  });

  it("reports Storage cleanup failures after deleting the QR record", async () => {
    rpc.mockResolvedValueOnce({ data: { type: "success", data: null }, error: null });
    remove.mockResolvedValueOnce({ error: { message: "Storage unavailable" } });
    await expect(deleteAdminGcashQr(filename)).resolves.toEqual({
      cleanupWarning: expect.stringContaining("Storage unavailable"),
    });
  });
});
