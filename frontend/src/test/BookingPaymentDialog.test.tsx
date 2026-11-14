import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { listPublicGcashQrs, toast } = vi.hoisted(() => ({
  listPublicGcashQrs: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/lib/gcashQrs", () => ({ listPublicGcashQrs }));
vi.mock("@/hooks/use-toast", () => ({ toast }));

import { BookingPaymentDialog } from "@/components/BookingPaymentDialog";

describe("BookingPaymentDialog cancellation", () => {
  beforeEach(() => {
    listPublicGcashQrs.mockReset().mockResolvedValue([
      { path: "https://example.com/gcash-qr.png", amount: 1000 },
    ]);
    toast.mockReset();
  });

  afterEach(() => cleanup());

  it("uses the X button to run the cancellation action before closing", async () => {
    const onOpenChange = vi.fn();
    const onBeforeClose = vi.fn().mockResolvedValue(true);

    render(
      <BookingPaymentDialog
        open
        onOpenChange={onOpenChange}
        onBeforeClose={onBeforeClose}
        preventOutsideClose
        onPaid={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() => {
      expect(onBeforeClose).toHaveBeenCalledOnce();
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it("does not dismiss on outside interaction or Escape", async () => {
    const onOpenChange = vi.fn();
    const onBeforeClose = vi.fn().mockResolvedValue(true);

    render(
      <BookingPaymentDialog
        open
        onOpenChange={onOpenChange}
        onBeforeClose={onBeforeClose}
        preventOutsideClose
        onPaid={vi.fn()}
      />,
    );

    await waitFor(() => expect(listPublicGcashQrs).toHaveBeenCalledOnce());
    fireEvent.pointerDown(document.body, { button: 0 });
    fireEvent.click(document.body);
    fireEvent.keyDown(document, { key: "Escape" });

    expect(await screen.findByRole("dialog")).not.toBeNull();
    expect(onBeforeClose).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("stays open if the cancellation action fails", async () => {
    const onOpenChange = vi.fn();
    const onBeforeClose = vi.fn().mockResolvedValue(false);

    render(
      <BookingPaymentDialog
        open
        onOpenChange={onOpenChange}
        onBeforeClose={onBeforeClose}
        preventOutsideClose
        onPaid={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() => expect(onBeforeClose).toHaveBeenCalledOnce());
    expect(screen.getByRole("dialog")).not.toBeNull();
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
