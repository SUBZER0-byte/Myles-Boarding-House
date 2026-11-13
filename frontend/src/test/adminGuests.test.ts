import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke } },
}));

import {
  createAdminGuest,
  deleteAdminGuest,
  listAdminGuests,
  setAdminGuestActive,
  updateAdminGuest,
  uploadAdminGuestPicture,
} from "@/lib/adminGuests";

describe("Admin guest Supabase workflows", () => {
  beforeEach(() => invoke.mockReset());

  it("loads guests through the authenticated Admin function", async () => {
    const guests = [{ user_id: 7, full_name: "Guest", username: "guest7" }];
    invoke.mockResolvedValue({ data: { type: "success", data: guests }, error: null });

    await expect(listAdminGuests()).resolves.toEqual(guests);
    expect(invoke).toHaveBeenCalledWith("admin-guests", { body: { action: "list", data: {} } });
  });

  it("creates and updates guests without using the PHP endpoint", async () => {
    invoke.mockResolvedValueOnce({ data: { type: "success", user_id: 8 }, error: null });
    invoke.mockResolvedValueOnce({ data: { type: "success" }, error: null });
    const guest = { full_name: "New Guest", email: "guest@example.com" };

    await expect(createAdminGuest(guest)).resolves.toBe(8);
    await expect(updateAdminGuest({ ...guest, user_id: 8 })).resolves.toBeUndefined();
    expect(invoke).toHaveBeenNthCalledWith(1, "admin-guests", { body: { action: "create", data: guest } });
    expect(invoke).toHaveBeenNthCalledWith(2, "admin-guests", {
      body: { action: "update", data: { ...guest, user_id: 8 } },
    });
  });

  it("handles status, deletion, and picture uploads through the Admin function", async () => {
    invoke.mockResolvedValue({ data: { type: "success" }, error: null });
    await setAdminGuestActive(8, false);
    await deleteAdminGuest(8);
    await uploadAdminGuestPicture(8, new File(["image"], "guest.png", { type: "image/png" }));

    expect(invoke).toHaveBeenNthCalledWith(1, "admin-guests", {
      body: { action: "deactivate", data: { user_id: 8 } },
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "admin-guests", {
      body: { action: "delete", data: { user_id: 8 } },
    });
    const uploadCall = invoke.mock.calls[2];
    expect(uploadCall[0]).toBe("admin-guests");
    expect(uploadCall[1].body).toBeInstanceOf(FormData);
  });

  it("rejects oversized or unsupported pictures before sending them", async () => {
    const invalidFile = new File(["x"], "guest.gif", { type: "image/gif" });
    await expect(uploadAdminGuestPicture(8, invalidFile)).rejects.toThrow("must be JPG, PNG, or WEBP");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("accepts the existing 10MB picture limit and rejects larger files", async () => {
    invoke.mockResolvedValue({ data: { type: "success" }, error: null });
    const maxFile = new File([new Uint8Array(10 * 1024 * 1024)], "guest.png", { type: "image/png" });
    await expect(uploadAdminGuestPicture(8, maxFile)).resolves.toBeUndefined();

    const oversizedFile = new File([new Uint8Array(10 * 1024 * 1024 + 1)], "guest.png", { type: "image/png" });
    await expect(uploadAdminGuestPicture(8, oversizedFile)).rejects.toThrow("10MB or smaller");
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
