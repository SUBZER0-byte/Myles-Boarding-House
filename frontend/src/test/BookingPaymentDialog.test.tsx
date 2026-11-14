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

  it("requires a screenshot before submitting when configured for guest booking payment", async () => {
    const onPaid = vi.fn();

    render(
      <BookingPaymentDialog
        open
        onOpenChange={vi.fn()}
        requireReference
        requireScreenshot
        allowScreenshot
        onPaid={onPaid}
      />,
    );

    await waitFor(() => expect(listPublicGcashQrs).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: /GCash/i }));
    fireEvent.change(screen.getByLabelText("GCash transaction reference *"), {
      target: { value: "TX-123" },
    });
    const submit = screen.getByRole("button", { name: "I’ve paid — submit for review" });
    const screenshotInput = screen.getByLabelText("GCash payment screenshot *");
    expect(submit).toBeDisabled();
    expect(screenshotInput).toBeRequired();

    const screenshot = new File(["receipt"], "receipt.png", { type: "image/png" });
    fireEvent.change(screenshotInput, {
      target: { files: [screenshot] },
    });

    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    await waitFor(() => expect(onPaid).toHaveBeenCalledWith(
      "GCash",
      "TX-123",
      undefined,
      undefined,
      screenshot,
    ));
  });
});
