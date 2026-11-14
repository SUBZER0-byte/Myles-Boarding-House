import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { listPublicGcashQrs, toast } = vi.hoisted(() => ({
  listPublicGcashQrs: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/lib/gcashQrs", () => ({ listPublicGcashQrs }));
vi.mock("@/hooks/use-toast", () => ({ toast }));

import { BookingPaymentDialog } from "@/components/BookingPaymentDialog";

describe("BookingPaymentDialog close behavior", () => {
  beforeEach(() => {
    listPublicGcashQrs.mockReset().mockResolvedValue([
      { path: "https://example.com/gcash-qr.png", amount: 1000 },
    ]);
    toast.mockReset();
  });

  afterEach(() => cleanup());

  it("closes through the X without submitting a payment", async () => {
    const onOpenChange = vi.fn();
    const onPaid = vi.fn();

    render(
      <BookingPaymentDialog
        open
        onOpenChange={onOpenChange}
        preventOutsideClose
        onPaid={onPaid}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
    expect(onPaid).not.toHaveBeenCalled();
  });

  it("does not dismiss on outside interaction or Escape", async () => {
    const onOpenChange = vi.fn();

    render(
      <BookingPaymentDialog
        open
        onOpenChange={onOpenChange}
        preventOutsideClose
        onPaid={vi.fn()}
      />,
    );

    await waitFor(() => expect(listPublicGcashQrs).toHaveBeenCalledOnce());
    fireEvent.pointerDown(document.body, { button: 0 });
    fireEvent.click(document.body);
    fireEvent.keyDown(document, { key: "Escape" });

    expect(await screen.findByRole("dialog")).not.toBeNull();
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
