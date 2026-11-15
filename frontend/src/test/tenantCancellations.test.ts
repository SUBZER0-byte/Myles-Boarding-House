import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc },
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
  beforeEach(() => rpc.mockReset());

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
    rpc.mockResolvedValue({ data: { type: "success", data: null }, error: null });

    await submitMyCancellationRequest();
    expect(rpc).toHaveBeenLastCalledWith("manage_tenant_cancellation", {
      p_action: "tenant_request",
      p_data: {},
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
  });

  it("validates filters and rejection reasons before calling Supabase", async () => {
    expect(() => getAdminCancellations("invalid")).toThrow("Invalid cancellation status");
    expect(() => rejectTenantCancellation(12, "  ")).toThrow("rejection reason");
    expect(rpc).not.toHaveBeenCalled();
  });
});
