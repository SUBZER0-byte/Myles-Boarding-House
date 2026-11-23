import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, getUser, upload, createSignedUrl, fromTable, functionsInvoke } = vi.hoisted(() => ({
  rpc: vi.fn(),
  getUser: vi.fn(),
  upload: vi.fn(),
  createSignedUrl: vi.fn(),
  fromTable: vi.fn(),
  functionsInvoke: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc,
    from: fromTable,
    auth: { getUser },
    functions: { invoke: functionsInvoke },
    storage: {
      from: () => ({ upload, createSignedUrl }),
    },
  },
}));

import {
  acquireMyGuestRoomHold,
  cancelMyGuestBooking,
  confirmAdminBookingPayment,
  createMyGuestBooking,
  getGuestBookingBoundaryDates,
  listAdminGuestBookings,
  listMyGuestBookings,
  submitMyBookingInitialPayment,
} from "@/lib/guestBookings";

describe("Supabase guest booking service", () => {
  beforeEach(() => {
    rpc.mockReset();
    functionsInvoke.mockReset();
    functionsInvoke.mockResolvedValue({
      data: { status: "sent", sent: 1, failed: 0 },
      error: null,
    });
    getUser.mockReset();
    upload.mockReset();
    createSignedUrl.mockReset();
    fromTable.mockReset();
    fromTable.mockImplementation(() => {
      const builder: Record<string, unknown> = {};
      builder.select = vi.fn(() => builder);
      builder.eq = vi.fn(() => builder);
      builder.then = (resolve: (value: unknown) => unknown) => resolve({ data: [], error: null });
      return builder;
    });
    rpc.mockImplementation((name: string) => Promise.resolve(name === "get_public_rooms_for_guest_browse_with_booking_state"
      ? { data: [], error: null }
      : { data: { type: "success", data: [] }, error: null }));
  });

  it("loads scheduled dates through the restricted database function and removes duplicates", async () => {
    rpc.mockResolvedValueOnce({
      data: ["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-27", "2026-11-28", "2026-11-28"],
      error: null,
    });

    await expect(getGuestBookingBoundaryDates(34)).resolves.toEqual({
      room_id: 34,
      dates: [
        "2026-11-23",
        "2026-11-24",
        "2026-11-25",
        "2026-11-27",
        "2026-11-28",
      ],
    });
    const args = rpc.mock.calls[0][1];
    expect(rpc.mock.calls[0][0]).toBe("get_guest_booking_boundary_dates");
    expect(args.p_room_id).toBe(34);
    expect(args.p_from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(args.p_until).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("surfaces database function errors and rejects malformed date responses", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: new Error("permission denied") });
    await expect(getGuestBookingBoundaryDates(34)).rejects.toThrow("permission denied");

    rpc.mockResolvedValueOnce({ data: ["not-a-date"], error: null });
    await expect(getGuestBookingBoundaryDates(34)).rejects.toThrow("invalid scheduled dates");
  });

  it("uses identity-scoped RPCs instead of caller-supplied email or user IDs", async () => {
    await listMyGuestBookings();
    await cancelMyGuestBooking(15);

    expect(rpc).toHaveBeenNthCalledWith(1, "manage_guest_booking", {
      p_action: "guest_list",
      p_data: {},
    });
    expect(rpc.mock.calls[1][0]).toBe("get_public_rooms_for_guest_browse_with_booking_state");
    expect(rpc).toHaveBeenNthCalledWith(3, "manage_guest_booking", {
      p_action: "guest_cancel",
      p_data: { booking_id: 15 },
    });
    expect(JSON.stringify(rpc.mock.calls)).not.toContain("email");
    expect(JSON.stringify(rpc.mock.calls)).not.toContain("user_id");
  });

  it("adds the current floor for a guest booking", async () => {
    rpc.mockImplementation((name: string, args: { p_action?: string }) => Promise.resolve(
      name === "get_public_rooms_for_guest_browse_with_booking_state"
        ? {
          data: [{
            room_id: 9,
            floor_number: 2,
            reservation_count: 0,
            reservation_deadlines_epoch: [],
            reservation_server_now_epoch: 1795651200,
          }],
          error: null,
        }
        : {
          data: {
            type: "success",
            data: args.p_action === "guest_list" ? [{ booking_id: 12, room_id: 9 }] : [],
          },
          error: null,
        },
    ));

    await expect(listMyGuestBookings()).resolves.toMatchObject([
      { booking_id: 12, room_id: 9, floor_number: 2 },
    ]);
  });

  it("rejects unavailable/unauthenticated RPC operations instead of converting them to success", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: new Error("JWT required") });
    await expect(listMyGuestBookings()).rejects.toThrow("JWT required");
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("validates room identifiers before making a hold request", async () => {
    expect(() => acquireMyGuestRoomHold({ room_id: 0 })).toThrow(/valid room/i);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("surfaces the server rejection when the guest already has an active booking for that room", async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: new Error("You already have an active booking for this room"),
    });

    await expect(acquireMyGuestRoomHold({ room_id: 8 }))
      .rejects.toThrow("You already have an active booking for this room");
  });

  it("sends booking retries with their idempotency key and does not send an email identity", async () => {
    const input = {
      room_id: 8,
      full_name: "Guest User",
      phone: "09170000000",
      move_in_date: "2026-12-01",
      check_out_date: "2027-01-01",
      payment_plan: "Pay Monthly",
      notes: "",
      idempotency_key: "cd968ff0-0e22-4bf1-8c4a-4c0a23bb8da4",
    };
    rpc
      .mockResolvedValueOnce({
        data: {
          type: "success",
          data: {
            booking_id: 15,
            initial_payment_amount: 1000,
            payment_expires_at_epoch: 1795653000,
            server_now_epoch: 1795651200,
          },
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          payment_expires_at_epoch: 1795737600,
          server_now_epoch: 1795651200,
        },
        error: null,
      });
    await expect(createMyGuestBooking(input)).resolves.toMatchObject({
      booking_id: 15,
      payment_expires_at_epoch: 1795737600,
      server_now_epoch: 1795651200,
    });
    expect(rpc).toHaveBeenCalledWith("manage_guest_booking", {
      p_action: "create",
      p_data: input,
    });
    expect(rpc.mock.calls[0][1].p_data).not.toHaveProperty("email");
    expect(rpc).toHaveBeenNthCalledWith(2, "get_guest_booking_reservation_deadline", {
      p_booking_id: 15,
    });
  });

  it("stores proof in the caller's private Storage folder and links only the path through the RPC", async () => {
    const file = new File(["receipt"], "receipt.png", { type: "image/png" });
    getUser.mockResolvedValue({ data: { user: { id: "auth-guest-id" } }, error: null });
    upload.mockResolvedValue({ error: null });
    const key = "cd968ff0-0e22-4bf1-8c4a-4c0a23bb8da4";

    const smsResult = await submitMyBookingInitialPayment(15, "GCash", " TX-123 ", file, key);

    expect(smsResult).toEqual({ status: "sent", sent: 1, failed: 0 });
    expect(functionsInvoke).toHaveBeenCalledWith("booking-sms-notifications", {
      body: { action: "payment_submitted", booking_id: 15 },
    });
    const path = `auth-guest-id/15/${key}.png`;
    expect(upload).toHaveBeenCalledWith(path, file, {
      contentType: "image/png",
      upsert: false,
    });
    expect(rpc).toHaveBeenCalledWith("manage_guest_booking", {
      p_action: "submit_initial_payment",
      p_data: {
        booking_id: 15,
        method: "GCash",
        reference: "TX-123",
        screenshot_path: path,
        submission_key: key,
      },
    });
  });

  it("reports notification failure without treating the submitted payment as a failure", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const file = new File(["receipt"], "receipt.png", { type: "image/png" });
    const key = "cd968ff0-0e22-4bf1-8c4a-4c0a23bb8da4";
    getUser.mockResolvedValue({ data: { user: { id: "auth-guest-id" } }, error: null });
    upload.mockResolvedValue({ error: null });
    functionsInvoke.mockResolvedValueOnce({
      data: null,
      error: new Error("SMS service unavailable"),
    });

    await expect(submitMyBookingInitialPayment(15, "GCash", "TX-123", file, key))
      .resolves.toMatchObject({ status: "failed", sent: 0, failed: 1 });
    expect(rpc).toHaveBeenCalledWith("manage_guest_booking", expect.objectContaining({
      p_action: "submit_initial_payment",
    }));
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("notifies the guest after the admin confirms the initial booking payment", async () => {
    await expect(confirmAdminBookingPayment(15)).resolves.toEqual({
      status: "sent",
      sent: 1,
      failed: 0,
    });

    expect(rpc).toHaveBeenCalledWith("manage_guest_booking", {
      p_action: "admin_confirm_initial_payment",
      p_data: { booking_id: 15 },
    });
    expect(functionsInvoke).toHaveBeenCalledWith("booking-sms-notifications", {
      body: { action: "booking_confirmed", booking_id: 15 },
    });
  });

  it("rejects a booking payment without a reference even when a screenshot is attached", async () => {
    const file = new File(["receipt"], "receipt.png", { type: "image/png" });
    const key = "cd968ff0-0e22-4bf1-8c4a-4c0a23bb8da4";

    await expect(submitMyBookingInitialPayment(15, "GCash", "  ", file, key))
      .rejects.toThrow("Enter the GCash transaction reference.");

    expect(getUser).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a booking payment without a screenshot before calling Supabase", async () => {
    const key = "cd968ff0-0e22-4bf1-8c4a-4c0a23bb8da4";

    await expect(submitMyBookingInitialPayment(15, "GCash", "TX-123", undefined, key))
      .rejects.toThrow("Upload the GCash payment screenshot.");

    expect(getUser).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("creates short-lived Admin proof links for safe Storage paths and rejects unsafe paths", async () => {
    const id = "cd968ff0-0e22-4bf1-8c4a-4c0a23bb8da4";
    rpc.mockResolvedValueOnce({
      data: {
        type: "success",
        data: [
          { booking_id: 15, gcash_submitted_screenshot: `9c9b2860-f35e-4461-a022-47bf12fe7161/15/${id}.png` },
          { booking_id: 16, gcash_submitted_screenshot: "legacy/uploads/proof.png" },
          { booking_id: 17, gcash_submitted_screenshot: "../private/proof.png" },
        ],
      },
      error: null,
    });
    rpc.mockResolvedValueOnce({
      data: [
        { booking_id: 15, gender: "Female" },
        { booking_id: 16, gender: null },
        { booking_id: 17, gender: "Male" },
      ],
      error: null,
    });
    createSignedUrl.mockResolvedValue({
      data: { signedUrl: "https://storage.example/signed-proof" },
      error: null,
    });

    const rows = await listAdminGuestBookings();
    expect(createSignedUrl).toHaveBeenCalledWith(`9c9b2860-f35e-4461-a022-47bf12fe7161/15/${id}.png`, 300);
    expect(createSignedUrl).toHaveBeenCalledWith("legacy/uploads/proof.png", 300);
    expect(rows).toEqual([
      { booking_id: 15, gender: "Female", gcash_submitted_screenshot: "https://storage.example/signed-proof" },
      { booking_id: 16, gender: null, gcash_submitted_screenshot: "https://storage.example/signed-proof" },
      { booking_id: 17, gender: "Male", gcash_submitted_screenshot: null, proof_unavailable: true },
    ]);
  });
});
