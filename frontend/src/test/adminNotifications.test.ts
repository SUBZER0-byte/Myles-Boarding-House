import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke } },
}));

import {
  listAdminNotifications,
  listNotificationRecipients,
  sendAdminNotification,
} from "@/lib/adminNotifications";

describe("admin notification operations", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it("loads the current administrator's notifications", async () => {
    const notifications = [{ notification_id: 1, user_id: 2, username: "admin", title: "Hi", message: "Body", type: "info", is_read: 0, created_at: "2026-01-01" }];
    invoke.mockResolvedValue({ data: { type: "success", data: notifications }, error: null });

    await expect(listAdminNotifications()).resolves.toEqual(notifications);
    expect(invoke).toHaveBeenCalledWith("admin-notifications", { body: { action: "list" } });
  });

  it("loads active recipients", async () => {
    const recipients = [{ user_id: 3, username: "tenant", full_name: "Test", user_type: "Tenant", email: "test@example.com", label: "Test tenant" }];
    invoke.mockResolvedValue({ data: { type: "success", data: recipients }, error: null });

    await expect(listNotificationRecipients()).resolves.toEqual(recipients);
    expect(invoke).toHaveBeenCalledWith("admin-notifications", { body: { action: "users" } });
  });

  it("supports targeted sends and audience broadcasts", async () => {
    invoke.mockResolvedValue({ data: { type: "success", message: "Sent" }, error: null });

    await sendAdminNotification({ user_id: 3, title: "Hi", message: "Body", type: "info" });
    await sendAdminNotification({ user_type: "Tenant", title: "Hi", message: "Body", type: "warning" });

    expect(invoke).toHaveBeenNthCalledWith(1, "admin-notifications", {
      body: { action: "send", user_id: 3, title: "Hi", message: "Body", type: "info" },
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "admin-notifications", {
      body: { action: "broadcast", user_type: "Tenant", title: "Hi", message: "Body", type: "warning" },
    });
  });
});
