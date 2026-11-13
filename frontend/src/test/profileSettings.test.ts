import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  rpc,
  getUser,
  signInWithPassword,
  updateUser,
  getPublicUrl,
} = vi.hoisted(() => ({
  rpc: vi.fn(),
  getUser: vi.fn(),
  signInWithPassword: vi.fn(),
  updateUser: vi.fn(),
  getPublicUrl: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc,
    auth: { getUser, signInWithPassword, updateUser },
    storage: { from: vi.fn(() => ({ getPublicUrl })) },
  },
}));

import {
  changeMyPassword,
  getMySettingsProfile,
  getProfilePictureUrl,
  requestMyEmailChange,
  saveMySettingsProfile,
} from "@/lib/profileSettings";

describe("Supabase profile settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPublicUrl.mockImplementation((path: string) => ({ data: { publicUrl: `https://storage.example/${path}` } }));
  });

  it("only resolves profile pictures stored in Supabase Storage", () => {
    expect(getProfilePictureUrl("00000000-0000-4000-8000-000000000001/photo.png"))
      .toBe("https://storage.example/00000000-0000-4000-8000-000000000001/photo.png");
    expect(getProfilePictureUrl("legacy-profile.jpg")).toBe("");
  });

  it("loads the current profile through the authenticated settings RPC", async () => {
    const profile = {
      user_id: 7,
      full_name: "Test Tenant",
      username: "testtenant",
      email: "tenant@example.com",
      user_type: "Tenant",
    };
    rpc.mockResolvedValue({ data: [profile], error: null });

    await expect(getMySettingsProfile()).resolves.toMatchObject(profile);
    expect(rpc).toHaveBeenCalledWith("get_my_settings_profile");
  });

  it("saves profile fields without allowing a caller-supplied user id", async () => {
    rpc.mockResolvedValue({ data: null, error: null });

    await saveMySettingsProfile({
      user_id: 7,
      full_name: "Test Tenant",
      username: "testtenant",
      email: "tenant@example.com",
      phone: "09123456789",
      address: "",
      age: "",
      birthday: null,
      user_type: "Tenant",
      emergency_contact_name: "",
      emergency_contact_phone: "",
    });

    expect(rpc).toHaveBeenCalledWith("update_my_settings_profile", expect.objectContaining({
      p_full_name: "Test Tenant",
      p_age: null,
      p_birthday: null,
    }));
    expect(rpc.mock.calls[0][1]).not.toHaveProperty("user_id");
  });

  it("rejects an invalid age before making a profile update", async () => {
    await expect(saveMySettingsProfile({
      user_id: 7,
      full_name: "Test Tenant",
      username: "testtenant",
      email: "tenant@example.com",
      phone: null,
      address: null,
      age: 121,
      birthday: null,
      user_type: "Tenant",
      emergency_contact_name: null,
      emergency_contact_phone: null,
    })).rejects.toThrow("Age must be a number from 0 to 120.");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("requires the current password before setting the new password", async () => {
    getUser.mockResolvedValue({ data: { user: { email: "tenant@example.com" } }, error: null });
    signInWithPassword.mockResolvedValue({ error: new Error("Invalid login credentials") });

    await expect(changeMyPassword("wrong", "newpass123")).rejects.toThrow("Current password is incorrect.");
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("requests email confirmation through Supabase Auth", async () => {
    getUser.mockResolvedValue({ data: { user: { email: "tenant@example.com" } }, error: null });
    rpc.mockResolvedValue({ data: true, error: null });
    updateUser.mockResolvedValue({ error: null });

    await expect(requestMyEmailChange("new@example.com")).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith("is_my_profile_email_available", { p_email: "new@example.com" });
    expect(updateUser).toHaveBeenCalledWith({ email: "new@example.com" });
  });
});
