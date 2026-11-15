import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, getUser, upload, createSignedUrl } = vi.hoisted(() => ({
  rpc: vi.fn(),
  getUser: vi.fn(),
  upload: vi.fn(),
  createSignedUrl: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc,
    auth: { getUser },
    storage: {
      from: vi.fn(() => ({
        upload,
        createSignedUrl,
      })),
    },
  },
}));

import {
  getEligibleRefundPayments,
  getMyFullPaymentRequest,
  newFinancialRequestId,
  submitMyFullPaymentProof,
  submitMyRefundRequest,
} from "@/lib/financialWorkflows";

const authId = "ffe10000-0000-4000-8000-000000000001";

describe("Supabase financial workflows", () => {
  beforeEach(() => {
    rpc.mockReset();
    getUser.mockReset();
    upload.mockReset();
    createSignedUrl.mockReset();
    getUser.mockResolvedValue({ data: { user: { id: authId } }, error: null });
    upload.mockResolvedValue({ error: null });
    createSignedUrl.mockResolvedValue({ data: { signedUrl: "https://storage.example/signed" }, error: null });
    rpc.mockResolvedValue({ data: { type: "success", data: null }, error: null });
  });

  it("uses the owner-scoped RPC for full-payment reads and signs private QR paths", async () => {
    rpc.mockResolvedValue({
      data: {
        type: "success",
        data: {
          request_id: 7,
          total_amount: 2500,
          status: "Approved",
          admin_note: null,
          reference_number: null,
          qr_path: `${authId}/full-payment-qr/7/qr.png`,
          installments: [],
        },
      },
      error: null,
    });

    await expect(getMyFullPaymentRequest()).resolves.toMatchObject({
      request_id: 7,
      qr_url: "https://storage.example/signed",
    });
    expect(rpc).toHaveBeenCalledWith("manage_financial_workflows", {
      p_action: "tenant_full_current",
      p_data: {},
    });
    expect(createSignedUrl).toHaveBeenCalledWith(`${authId}/full-payment-qr/7/qr.png`, 300);
  });

  it("rejects malformed or oversized evidence before uploading or invoking an RPC", async () => {
    const key = "ffe10000-0000-4000-8000-000000000010";
    await expect(submitMyFullPaymentProof(7, "ref", new File(["x"], "proof.txt", { type: "text/plain" }), key))
      .rejects.toThrow("JPG, PNG, or WEBP");
    await expect(submitMyFullPaymentProof(0, "ref", new File(["x"], "proof.png", { type: "image/png" }), key))
      .rejects.toThrow("valid full payment request");
    expect(upload).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("uploads tenant proof under the verified auth UID and never accepts a caller-supplied owner ID", async () => {
    const key = "ffe10000-0000-4000-8000-000000000010";
    const file = new File(["proof"], "proof.png", { type: "image/png" });
    await submitMyFullPaymentProof(7, " transaction-7 ", file, key);

    expect(upload).toHaveBeenCalledWith(`${authId}/full-payment/7/${key}.png`, file, {
      contentType: "image/png",
      upsert: false,
    });
    expect(rpc).toHaveBeenCalledWith("manage_financial_workflows", {
      p_action: "tenant_full_submit_proof",
      p_data: {
        request_id: 7,
        reference_number: "transaction-7",
        screenshot_path: `${authId}/full-payment/7/${key}.png`,
        idempotency_key: key,
      },
    });
    expect(JSON.stringify(rpc.mock.calls)).not.toContain("user_id");
  });

  it("keeps refund eligibility and duplicate-submit retries behind server-derived identity", async () => {
    await getEligibleRefundPayments({ payment_id: 11 });
    expect(rpc).toHaveBeenLastCalledWith("manage_financial_workflows", {
      p_action: "refund_eligible",
      p_data: { payment_id: 11 },
    });

    const idempotencyKey = "ffe10000-0000-4000-8000-000000000020";
    const input = {
      payment_id: 11,
      gcash_account_name: "Account",
      gcash_number: "09170000000",
      transaction_reference: "txn-11",
      reason: "",
      idempotency_key: idempotencyKey,
    };
    await submitMyRefundRequest(input);
    await submitMyRefundRequest(input);
    expect(rpc).toHaveBeenCalledTimes(3);
    expect(rpc).toHaveBeenLastCalledWith("manage_financial_workflows", {
      p_action: "refund_submit",
      p_data: {
        ...input,
        screenshot_path: null,
      },
    });
    expect(newFinancialRequestId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });
});
