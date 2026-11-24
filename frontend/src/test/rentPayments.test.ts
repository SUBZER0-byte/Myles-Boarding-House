import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, getUser, upload, createSignedUrl, storageFrom } = vi.hoisted(() => {
  const rpc = vi.fn();
  const getUser = vi.fn();
  const upload = vi.fn();
  const createSignedUrl = vi.fn();
  const storageFrom = vi.fn(() => ({ upload, createSignedUrl }));
  return { rpc, getUser, upload, createSignedUrl, storageFrom };
});

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc,
    auth: { getUser },
    storage: { from: storageFrom },
  },
}));

import {
  getAdminRentPaymentScreenshot,
  listAdminRentPayments,
  listMyRentPayments,
  newRentPaymentSubmissionId,
  submitMyRentPayment,
} from "@/lib/rentPayments";

const authId = "ffe10000-0000-4000-8000-000000000001";
const submissionId = "ffe10000-0000-4000-8000-000000000010";

describe("Supabase rent payment workflows", () => {
  beforeEach(() => {
    rpc.mockReset();
    getUser.mockReset();
    upload.mockReset();
    createSignedUrl.mockReset();
    storageFrom.mockClear();
    getUser.mockResolvedValue({ data: { user: { id: authId } }, error: null });
    upload.mockResolvedValue({ error: null });
    createSignedUrl.mockResolvedValue({ data: { signedUrl: "https://storage.example/signed" }, error: null });
    rpc.mockResolvedValue({ data: { type: "success", data: [] }, error: null });
  });

  it("uses the authenticated tenant history RPC without accepting a tenant ID", async () => {
    await expect(listMyRentPayments()).resolves.toEqual([]);
    expect(rpc).toHaveBeenCalledWith("manage_rent_ledger", {
      p_action: "tenant_history",
      p_data: {},
    });
  });

  it("rejects malformed or oversized evidence before upload or RPC", async () => {
    await expect(submitMyRentPayment({
      payment_id: 7,
      reference: "",
      submission_id: submissionId,
    })).rejects.toThrow("Enter a GCash transaction reference");
    await expect(submitMyRentPayment({
      payment_id: 7,
      reference: "ref",
      screenshot: new File(["x"], "proof.txt", { type: "text/plain" }),
      submission_id: submissionId,
    })).rejects.toThrow("JPG, PNG, or WEBP");
    expect(upload).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("uploads evidence under the verified auth UID and submits only the payment proof path", async () => {
    const file = new File(["proof"], "proof.png", { type: "image/png" });
    await submitMyRentPayment({
      payment_id: 7,
      reference: " transaction-7 ",
      screenshot: file,
      submission_id: submissionId,
    });

    const path = `${authId}/rent-payment/7/${submissionId}.png`;
    expect(upload).toHaveBeenCalledWith(path, file, {
      contentType: "image/png",
      upsert: false,
    });
    expect(rpc).toHaveBeenCalledWith("manage_rent_ledger", {
      p_action: "tenant_submit",
      p_data: {
        payment_id: 7,
        reference: "transaction-7",
        screenshot_path: path,
      },
    });
    expect(JSON.stringify(rpc.mock.calls)).not.toContain("tenant_id");
  });

  it("signs rent-payment proof URLs from the financial evidence bucket", async () => {
    await listAdminRentPayments({ tenant_id: 4, status: "Submitted" });
    expect(rpc).toHaveBeenCalledWith("manage_rent_ledger", {
      p_action: "admin_list",
      p_data: { tenant_id: 4, status: "Submitted" },
    });

    const path = `${authId}/rent-payment/350/${submissionId}.png`;
    await expect(getAdminRentPaymentScreenshot(path))
      .resolves.toBe("https://storage.example/signed");
    expect(storageFrom).toHaveBeenCalledWith("mbh-financial-evidence");
    expect(createSignedUrl).toHaveBeenCalledWith(path, 300);
  });

  it("signs booking-origin payment proofs from the booking proof bucket", async () => {
    const path = `${authId}/123/${submissionId}.jpg`;

    await expect(getAdminRentPaymentScreenshot(path))
      .resolves.toBe("https://storage.example/signed");
    expect(storageFrom).toHaveBeenCalledWith("mbh-booking-payment-proofs");
    expect(createSignedUrl).toHaveBeenCalledWith(path, 300);
  });

  it("uses UUID request keys and propagates upload failures", async () => {
    expect(newRentPaymentSubmissionId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    upload.mockResolvedValueOnce({ error: { message: "Storage unavailable" } });
    await expect(submitMyRentPayment({
      payment_id: 7,
      reference: "ref",
      screenshot: new File(["proof"], "proof.png", { type: "image/png" }),
      submission_id: submissionId,
    })).rejects.toThrow("Storage unavailable");
    expect(rpc).not.toHaveBeenCalled();
  });
});
