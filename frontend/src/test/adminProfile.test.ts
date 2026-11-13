import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, getUser, updateUser } = vi.hoisted(() => ({
  rpc: vi.fn(),
  getUser: vi.fn(),
  updateUser: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc,
    auth: { getUser, updateUser },
  },
}));

import {
  getMyAdminSettingsProfile,
  requestAdminEmailChange,
  saveMyAdminSettingsProfile,
} from "@/lib/adminProfile";

describe("Admin profile settings", () => {
  beforeEach(() => {
    rpc.mockReset();
    getUser.mockReset();
    updateUser.mockReset();
  });

  it("loads and updates only the authenticated Admin profile", async () => {
    const profile = {
      user_id: 1,
      full_name: "Admin User",
      username: "admin",
      email: "admin@example.com",
      phone: "09123456789",
      profile_picture: null,
    };
    rpc.mockResolvedValueOnce({ data: [profile], error: null });
    rpc.mockResolvedValueOnce({ data: null, error: null });

    await expect(getMyAdminSettingsProfile()).resolves.toEqual(profile);
    await saveMyAdminSettingsProfile(profile);
    expect(rpc).toHaveBeenNthCalledWith(1, "get_my_admin_settings_profile");
    expect(rpc).toHaveBeenNthCalledWith(2, "update_my_admin_settings_profile", {
      p_full_name: "Admin User",
      p_phone: "09123456789",
    });
  });

  it("requests email confirmation only after checking availability", async () => {
    getUser.mockResolvedValue({ data: { user: { email: "admin@example.com" } }, error: null });
    rpc.mockResolvedValue({ data: true, error: null });
    updateUser.mockResolvedValue({ error: null });

    await expect(requestAdminEmailChange("next@example.com")).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith("is_my_admin_email_available", { p_email: "next@example.com" });
    expect(updateUser).toHaveBeenCalledWith({ email: "next@example.com" });
  });
});
