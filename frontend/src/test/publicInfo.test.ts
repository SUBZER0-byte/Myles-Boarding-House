import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc },
}));

import { getPublicAnnouncements, getPublicHouseInfo } from "@/lib/publicInfo";

describe("public information reads", () => {
  beforeEach(() => {
    rpc.mockReset();
  });

  it("uses the public announcements RPC", async () => {
    const announcements = [{ announcement_id: 3, title: "Update", body: "Hello", created_at: "2026-01-01" }];
    rpc.mockResolvedValue({ data: announcements, error: null });

    await expect(getPublicAnnouncements()).resolves.toEqual(announcements);
    expect(rpc).toHaveBeenCalledWith("get_public_announcements");
  });

  it("requires a row from the public house info RPC", async () => {
    const houseInfo = {
      house_address_line_1: "A",
      house_address_line_2: "B",
      house_contact_phone: "123",
      house_contact_email: "test@example.com",
      house_office_hours_line_1: "Weekdays: 8:00 AM – 6:00 PM",
      house_office_hours_line_2: "Weekends: By appointment",
      house_map_lat: "13.1",
      house_map_lng: "123.7",
    };
    rpc.mockResolvedValue({ data: [houseInfo], error: null });

    await expect(getPublicHouseInfo()).resolves.toEqual(houseInfo);
    expect(rpc).toHaveBeenCalledWith("get_public_house_info");
  });

  it("propagates RPC errors", async () => {
    const failure = new Error("RPC unavailable");
    rpc.mockResolvedValue({ data: null, error: failure });

    await expect(getPublicAnnouncements()).rejects.toBe(failure);
  });
});
