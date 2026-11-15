import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getPublicRooms } = vi.hoisted(() => ({ getPublicRooms: vi.fn() }));

vi.mock("@/lib/publicRooms", () => ({ getPublicRooms }));

import { usePublicRooms } from "@/hooks/usePublicRooms";

describe("usePublicRooms", () => {
  beforeEach(() => {
    getPublicRooms.mockReset();
  });

  it("keeps an empty live result distinct from loading", async () => {
    getPublicRooms.mockResolvedValue([]);
    const { result, unmount } = renderHook(() => usePublicRooms(60000));

    await waitFor(() => expect(result.current.rooms).toEqual([]));
    expect(result.current.error).toBeNull();
    unmount();
  });

  it("exposes Supabase read failures", async () => {
    getPublicRooms.mockRejectedValue(new Error("RPC unavailable"));
    const { result, unmount } = renderHook(() => usePublicRooms(60000));

    await waitFor(() => expect(result.current.error?.message).toBe("RPC unavailable"));
    expect(result.current.rooms).toBeNull();
    unmount();
  });
});
