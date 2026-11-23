import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, functionsInvoke } = vi.hoisted(() => ({
  rpc: vi.fn(),
  functionsInvoke: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc,
    functions: { invoke: functionsInvoke },
  },
}));

import {
  approveTenantCancellation,
  getAdminCancellations,
  getMyCancellationStatus,
  rejectTenantCancellation,
  submitMyCancellationRequest,
  withdrawMyCancellationRequest,
} from "@/lib/tenantCancellations";

describe("Tenant cancellations", () => {
  beforeEach(() => {
    rpc.mockReset();
    functionsInvoke.mockReset();
    functionsInvoke.mockResolvedValue({
      data: { status: "sent", sent: 1, failed: 0 },
      error: null,
    });
  });

  it("uses the authenticated cancellation RPC and returns tenant status", async () => {
    const status = { cancellation_id: 12, status: "Pending" };
    rpc.mockResolvedValue({ data: { type: "success", data: status }, error: null });

    await expect(getMyCancellationStatus()).resolves.toEqual(status);
    expect(rpc).toHaveBeenCalledWith("manage_tenant_cancellation", {
      p_action: "tenant_status",
      p_data: {},
    });
  });

  it("passes tenant and Admin actions without accepting client-supplied user IDs", async () => {
    rpc
      .mockResolvedValueOnce({
        data: {
          type: "success",
          data: { cancellation_id: 12, expires_at: "2026-11-24T01:00:00" },
        },
        error: null,
      })
      .mockResolvedValue({ data: { type: "success", message: "Cancellation action completed" }, error: null });

    await submitMyCancellationRequest();
    expect(rpc).toHaveBeenLastCalledWith("manage_tenant_cancellation", {
      p_action: "tenant_request",
      p_data: {},
    });
    expect(functionsInvoke).toHaveBeenLastCalledWith("cancellation-sms-notifications", {
      body: { action: "cancellation_submitted", cancellation_id: 12 },
    });
    await withdrawMyCancellationRequest(12);
    expect(rpc).toHaveBeenLastCalledWith("manage_tenant_cancellation", {
      p_action: "tenant_withdraw",
      p_data: { cancellation_id: 12 },
    });
    await approveTenantCancellation(12);
    expect(rpc).toHaveBeenLastCalledWith("manage_tenant_cancellation", {
      p_action: "admin_approve",
      p_data: { cancellation_id: 12 },
    });
    expect(functionsInvoke).toHaveBeenLastCalledWith("cancellation-sms-notifications", {
      body: { action: "cancellation_approved", cancellation_id: 12 },
    });
  });

  it("sends the stored Admin rejection decision and reason to the tenant by SMS", async () => {
    rpc.mockResolvedValue({ data: { type: "success", message: "Cancellation rejected" }, error: null });

    await expect(rejectTenantCancellation(13, "  Outstanding balance remains.  ")).resolves.toEqual({
      status: "sent",
      sent: 1,
      failed: 0,
    });
    expect(rpc).toHaveBeenCalledWith("manage_tenant_cancellation", {
      p_action: "admin_reject",
      p_data: { cancellation_id: 13, rejection_reason: "Outstanding balance remains." },
    });
    expect(functionsInvoke).toHaveBeenCalledWith("cancellation-sms-notifications", {
      body: { action: "cancellation_rejected", cancellation_id: 13 },
    });
  });

  it("keeps a submitted request successful when the Admin SMS cannot be delivered", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.mockResolvedValueOnce({
      data: {
        type: "success",
        data: { cancellation_id: 18, expires_at: "2026-11-24T01:00:00" },
      },
      error: null,
    });
    functionsInvoke.mockResolvedValueOnce({
      data: null,
      error: new Error("SMS service unavailable"),
    });

    await expect(submitMyCancellationRequest()).resolves.toMatchObject({
      cancellation_id: 18,
      sms: { status: "failed", sent: 0, failed: 1 },
    });
    consoleError.mockRestore();
  });

  it("does not submit a rejection without a reason", async () => {
    await expect(rejectTenantCancellation(13, "  ")).rejects.toThrow("rejection reason");
    expect(rpc).not.toHaveBeenCalled();
    expect(functionsInvoke).not.toHaveBeenCalled();
  });

  it("validates filters and rejection reasons before calling Supabase", async () => {
    expect(() => getAdminCancellations("invalid")).toThrow("Invalid cancellation status");
    await expect(rejectTenantCancellation(12, "  ")).rejects.toThrow("rejection reason");
    expect(rpc).not.toHaveBeenCalled();
  });
});
