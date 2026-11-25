import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  rpc,
  getUser,
  signInWithPassword,
  updateUser,
  getPublicUrl,
  upload,
  remove,
} = vi.hoisted(() => ({
  rpc: vi.fn(),
  getUser: vi.fn(),
  signInWithPassword: vi.fn(),
  updateUser: vi.fn(),
  getPublicUrl: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc,
    auth: { getUser, signInWithPassword, updateUser },
    storage: { from: vi.fn(() => ({ getPublicUrl, upload, remove })) },
  },
}));

import {
  changeMyPassword,
  getMySettingsProfile,
  getProfilePictureUrl,
  MAX_PROFILE_PICTURE_SIZE_BYTES,
  requestMyEmailChange,
  saveMySettingsProfile,
  uploadMyProfilePicture,
} from "@/lib/profileSettings";

describe("Supabase profile settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPublicUrl.mockImplementation((path: string) => ({ data: { publicUrl: `https://storage.example/${path}` } }));
    upload.mockResolvedValue({ error: null });
    remove.mockResolvedValue({ error: null });
  });

  it("resolves existing and legacy relative Storage keys, rejecting external paths", () => {
    expect(getProfilePictureUrl("00000000-0000-4000-8000-000000000001/photo.png"))
      .toBe("https://storage.example/00000000-0000-4000-8000-000000000001/photo.png");
    expect(getProfilePictureUrl("profile_pictures/user_3/legacy-profile.jpg"))
      .toBe("https://storage.example/profile_pictures/user_3/legacy-profile.jpg");
    expect(getProfilePictureUrl("https://example.com/profile.jpg")).toBe("");
    expect(getProfilePictureUrl("../private.jpg")).toBe("");
  });

  it("allows profile picture uploads up to 100MB and rejects larger files", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "00000000-0000-4000-8000-000000000001" } }, error: null });
    rpc.mockResolvedValue({ data: null, error: null });
    const makeImage = (size: number) => {
      const file = new File(["image"], "profile.png", { type: "image/png" });
      Object.defineProperty(file, "size", { value: size });
      return file;
    };

    await uploadMyProfilePicture(makeImage(MAX_PROFILE_PICTURE_SIZE_BYTES));
    await expect(uploadMyProfilePicture(makeImage(MAX_PROFILE_PICTURE_SIZE_BYTES + 1)))
      .rejects.toThrow("100MB or smaller");

    expect(upload).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("set_my_profile_picture", {
      p_path: expect.stringMatching(/^00000000-0000-4000-8000-000000000001\/[0-9a-f-]+\.png$/),
    });
  });

  it("loads the current profile through the authenticated settings RPC", async () => {
    const profile = {
      user_id: 7,
      full_name: "Test Tenant",
      username: "testtenant",
      email: "tenant@example.com",
      user_type: "Tenant",
      gender: "Female",
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
      gender: "Female",
      emergency_contact_name: "",
      emergency_contact_phone: "",
    });

    expect(rpc).toHaveBeenCalledWith("update_my_settings_profile", expect.objectContaining({
      p_full_name: "Test Tenant",
      p_age: null,
      p_birthday: null,
      p_gender: "Female",
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
      gender: null,
      emergency_contact_name: null,
      emergency_contact_phone: null,
    })).rejects.toThrow("Age must be a number from 0 to 120.");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects unsupported gender values before making a profile update", async () => {
    await expect(saveMySettingsProfile({
      user_id: 7,
      full_name: "Test Tenant",
      username: "testtenant",
      email: "tenant@example.com",
      phone: null,
      address: null,
      age: null,
      birthday: null,
      user_type: "Tenant",
      gender: "Non-binary",
      emergency_contact_name: null,
      emergency_contact_phone: null,
    })).rejects.toThrow("Choose a valid gender.");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("allows an existing profile to leave gender unspecified", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await saveMySettingsProfile({
      user_id: 7,
      full_name: "Test Tenant",
      username: "testtenant",
      email: "tenant@example.com",
      phone: null,
      address: null,
      age: null,
      birthday: null,
      user_type: "Tenant",
      gender: null,
      emergency_contact_name: null,
      emergency_contact_phone: null,
    });
    expect(rpc).toHaveBeenCalledWith("update_my_settings_profile", expect.objectContaining({
      p_gender: null,
    }));
  });

  it("requires the current password before setting the new password", async () => {
    getUser.mockResolvedValue({ data: { user: { email: "tenant@example.com" } }, error: null });
    signInWithPassword.mockResolvedValue({ error: new Error("Invalid login credentials") });

    await expect(changeMyPassword("wrong", "newpass123")).rejects.toThrow("Current password is incorrect.");
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("rejects passwords outside the shared 6–200-character limit before verifying credentials", async () => {
    await expect(changeMyPassword("current-password", "12345"))
      .rejects.toThrow("Password must be 6–200 characters long.");
    await expect(changeMyPassword("current-password", "a".repeat(201)))
      .rejects.toThrow("Password must be 6–200 characters long.");
    expect(getUser).not.toHaveBeenCalled();
    expect(signInWithPassword).not.toHaveBeenCalled();
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
