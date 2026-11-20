import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke, rpc, setSession, setProfile } = vi.hoisted(() => ({
  invoke: vi.fn(),
  rpc: vi.fn(),
  setSession: vi.fn(),
  setProfile: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    functions: { invoke },
    rpc,
    auth: { setSession },
  },
}));

vi.mock("@/lib/api", () => ({
  sessionStore: { set: setProfile, clear: vi.fn() },
}));

import { signUpGuest } from "@/lib/auth";

describe("Supabase account registration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invoke.mockResolvedValue({
      data: {
        type: "success",
        session: { access_token: "access-token", refresh_token: "refresh-token" },
      },
      error: null,
    });
    setSession.mockResolvedValue({ data: { user: null }, error: null });
    rpc.mockResolvedValue({
      data: [{
        user_id: 7,
        username: "testguest",
        full_name: "Test Guest",
        email: "guest@example.com",
        phone: "09123456789",
        user_type: "Guest",
        gender: "Female",
      }],
      error: null,
    });
  });

  it("sends the selected gender through the auth signup function and reads it back", async () => {
    const input = {
      full_name: "Test Guest",
      username: "testguest",
      email: "guest@example.com",
      phone: "09123456789",
      address: "Manila",
      gender: "Female" as const,
      birthday: "2000-01-01",
      age: 26,
      emergency_contact_name: "Emergency Contact",
      emergency_contact_phone: "09987654321",
      password: "password1",
      otp: "123456",
    };

    const result = await signUpGuest(input, null);

    expect(invoke).toHaveBeenCalledWith("auth", { body: { action: "signup", ...input } });
    expect(rpc).toHaveBeenCalledWith("get_my_profile");
    expect(result.profile.gender).toBe("Female");
    expect(setProfile).toHaveBeenCalledWith(expect.objectContaining({ gender: "Female" }));
  });
});
