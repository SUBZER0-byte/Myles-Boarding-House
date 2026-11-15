import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc },
}));

import { getMyAdminHouseSettings, saveMyAdminHouseSettings } from "@/lib/adminHouseSettings";

describe("Admin house settings", () => {
  beforeEach(() => rpc.mockReset());

  it("loads the Admin house configuration through Supabase", async () => {
    const settings = { house_contact_phone: "+639123456789", house_weekday_open_time: "08:00" };
    rpc.mockResolvedValue({ data: settings, error: null });

    await expect(getMyAdminHouseSettings()).resolves.toEqual(settings);
    expect(rpc).toHaveBeenCalledWith("get_my_admin_house_settings");
  });

  it("saves only supplied house settings through the Admin RPC", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const settings = {
      house_address_line_1: "Lerma Street",
      house_weekend_by_appointment: "1",
    };

    await expect(saveMyAdminHouseSettings(settings)).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledWith("save_my_admin_house_settings", { p_settings: settings });
  });

  it("rejects malformed or out-of-scope settings", async () => {
    rpc.mockResolvedValue({ data: null, error: null });

    await expect(getMyAdminHouseSettings()).rejects.toThrow("invalid response");
    rpc.mockClear();
    await expect(saveMyAdminHouseSettings({ paypal_secret: "not allowed" })).rejects.toThrow("update is invalid");
    expect(rpc).not.toHaveBeenCalled();
  });
});
