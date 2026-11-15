import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke } },
}));

import {
  decideStayExtension,
  listStayExtensionRequests,
  requestStayExtension,
} from "@/lib/stayExtensions";

describe("stay extension workflows", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it("submits a tenant request without accepting browser-supplied user IDs", async () => {
    invoke.mockResolvedValue({
      data: { type: "success", message: "Request submitted." },
      error: null,
    });

    await expect(requestStayExtension("2027-03-15")).resolves.toBe("Request submitted.");
    expect(invoke).toHaveBeenCalledWith("stay-extensions", {
      body: {
        action: "tenant_request",
        data: { requested_check_out_date: "2027-03-15" },
      },
    });
  });

  it("loads Admin extension requests through the protected function", async () => {
    const requests = [{ request_id: 4, status: "Pending" }];
    invoke.mockResolvedValue({
      data: { type: "success", data: requests },
      error: null,
    });

    await expect(listStayExtensionRequests()).resolves.toEqual(requests);
    expect(invoke).toHaveBeenCalledWith("stay-extensions", {
      body: { action: "admin_list", data: {} },
    });
  });

  it("surfaces business-rule errors rather than treating decisions as successful", async () => {
    invoke.mockResolvedValue({
      data: { type: "error", message: "The room is already booked during the requested extension." },
      error: null,
    });

    await expect(decideStayExtension(4, "Approved")).rejects.toThrow(
      "The room is already booked during the requested extension.",
    );
    expect(invoke).toHaveBeenCalledWith("stay-extensions", {
      body: { action: "admin_decide", data: { request_id: 4, decision: "Approved" } },
    });
  });
});
