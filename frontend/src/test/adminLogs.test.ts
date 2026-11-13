import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke } },
}));

import { deleteAdminLog, listAdminLogs } from "@/lib/adminLogs";

describe("Admin log history", () => {
  beforeEach(() => {
    invoke.mockReset();
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
});
