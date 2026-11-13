import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke } },
}));

import {
  deleteAdminAnnouncement,
  listAdminAnnouncements,
  saveAdminAnnouncement,
  setAdminAnnouncementPublished,
} from "@/lib/adminAnnouncements";

describe("admin announcement operations", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it("loads announcements through the admin-only Edge Function", async () => {
    const announcements = [{ announcement_id: 1, title: "Update", body: "Hello", is_published: 1, created_at: "2026-01-01" }];
    invoke.mockResolvedValue({ data: { type: "success", data: announcements }, error: null });

    await expect(listAdminAnnouncements()).resolves.toEqual(announcements);
    expect(invoke).toHaveBeenCalledWith("admin-announcements", { body: { action: "list" } });
  });

  it("saves a new announcement without accepting an author ID from the browser", async () => {
    invoke.mockResolvedValue({ data: { type: "success", message: "Created" }, error: null });

    await saveAdminAnnouncement({ title: "Update", body: "Hello", is_published: 1 });
    expect(invoke).toHaveBeenCalledWith("admin-announcements", {
      body: { action: "create", title: "Update", body: "Hello", is_published: 1 },
    });
  });

  it("passes publish and delete actions through the function", async () => {
    invoke.mockResolvedValue({ data: { type: "success" }, error: null });

    await setAdminAnnouncementPublished(9, 0);
    await deleteAdminAnnouncement(9);

    expect(invoke).toHaveBeenNthCalledWith(1, "admin-announcements", {
      body: { action: "publish", announcement_id: 9, is_published: 0 },
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "admin-announcements", {
      body: { action: "delete", announcement_id: 9 },
    });
  });

  it("surfaces server validation failures", async () => {
    invoke.mockResolvedValue({ data: { type: "error", message: "Enter a title and announcement body." }, error: null });

    await expect(saveAdminAnnouncement({ title: "", body: "", is_published: 1 }))
      .rejects.toThrow("Enter a title and announcement body.");
  });
});
