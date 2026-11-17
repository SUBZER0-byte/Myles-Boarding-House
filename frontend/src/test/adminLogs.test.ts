import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke, rpc } = vi.hoisted(() => ({ invoke: vi.fn(), rpc: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke }, rpc },
}));

import { deleteAdminLog, listAdminLogs, recordAdminManagementLog } from "@/lib/adminLogs";

describe("Admin log history", () => {
  beforeEach(() => {
    invoke.mockReset();
    rpc.mockReset();
  });

  it("loads filtered logs through the Admin-only service", async () => {
    const logs = [{ log_id: 10, category: "auth", action: "sign_in" }];
    invoke.mockResolvedValue({ data: { type: "success", data: logs }, error: null });

    await expect(listAdminLogs({
      limit: 300,
      category: "auth",
      level: "warning",
      query: "denied",
    })).resolves.toEqual(logs);
    expect(invoke).toHaveBeenCalledWith("admin-logs", {
      body: {
        action: "list",
        data: { limit: 300, category: "auth", level: "warning", query: "denied" },
      },
    });
  });

  it("deletes a log entry via Supabase and surfaces business errors", async () => {
    invoke.mockResolvedValueOnce({
      data: { type: "success", message: "Log deleted." },
      error: null,
    });
    await expect(deleteAdminLog(10)).resolves.toBe("Log deleted.");
    expect(invoke).toHaveBeenCalledWith("admin-logs", {
      body: { action: "delete", data: { log_id: 10 } },
    });

    invoke.mockResolvedValueOnce({
      data: { type: "error", message: "Log entry not found." },
      error: null,
    });
    await expect(deleteAdminLog(99)).rejects.toThrow("Log entry not found.");
  });

  it("writes management CRUD events through the Admin-checked RPC", async () => {
    rpc.mockResolvedValue({ data: { type: "success", log_id: 14 }, error: null });
    await expect(recordAdminManagementLog({
      entity: "tenant",
      operation: "update",
      resourceId: 12,
      message: "Deactivated Tenant record #12.",
    })).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledWith("record_admin_management_log", {
      p_entity: "tenant",
      p_operation: "update",
      p_resource_id: 12,
      p_message: "Deactivated Tenant record #12.",
    });

    rpc.mockResolvedValueOnce({ data: null, error: { message: "Administrator access is required" } });
    await expect(recordAdminManagementLog({
      entity: "guest",
      operation: "delete",
      resourceId: 7,
      message: "Deleted Guest user #7.",
    })).rejects.toThrow("Administrator access is required");
  });
});
