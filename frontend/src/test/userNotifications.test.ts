import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke } },
}));

import {
  deleteUserNotification,
  getUserUnreadNotificationCount,
  listUserNotifications,
  markAllUserNotificationsRead,
  markUserNotificationRead,
} from "@/lib/userNotifications";

describe("user notification operations", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it("loads the current account's notifications through the Edge Function", async () => {
    const notifications = [{
      notification_id: 7,
      title: "Update",
      message: "Notice",
      type: "announcement",
      is_read: 0,
      created_at: "2026-01-01",
    }];
    invoke.mockResolvedValue({ data: { type: "success", data: notifications }, error: null });

    await expect(listUserNotifications()).resolves.toEqual(notifications);
    expect(invoke).toHaveBeenCalledWith("user-notifications", { body: { action: "list" } });
  });

  it("reads the unread count from the authenticated account", async () => {
    invoke.mockResolvedValue({ data: { type: "success", data: { count: 3 } }, error: null });

    await expect(getUserUnreadNotificationCount()).resolves.toBe(3);
    expect(invoke).toHaveBeenCalledWith("user-notifications", { body: { action: "unread_count" } });
  });

  it("performs ownership-scoped read and delete actions", async () => {
    invoke.mockResolvedValue({ data: { type: "success" }, error: null });

    await markUserNotificationRead(7);
    await markAllUserNotificationsRead();
    await deleteUserNotification(7);

    expect(invoke).toHaveBeenNthCalledWith(1, "user-notifications", {
      body: { action: "mark_read", notification_id: 7 },
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "user-notifications", {
      body: { action: "mark_all_read" },
    });
    expect(invoke).toHaveBeenNthCalledWith(3, "user-notifications", {
      body: { action: "delete", notification_id: 7 },
    });
  });
});
