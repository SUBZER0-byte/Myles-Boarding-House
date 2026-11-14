import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BookingTermsDialog } from "@/components/BookingTermsDialog";

describe("BookingTermsDialog cancellation", () => {
  afterEach(() => cleanup());

  it("only cancels through the X and does not continue the booking", () => {
    const onOpenChange = vi.fn();
    const onAccept = vi.fn();

    render(
      <BookingTermsDialog
        open
        onOpenChange={onOpenChange}
        onAccept={onAccept}
        roomName="Room 11"
      />,
    );

    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    fireEvent.pointerDown(document.body, { button: 0 });
    fireEvent.click(document.body);
    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.getByRole("dialog")).not.toBeNull();
    expect(onOpenChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onAccept).not.toHaveBeenCalled();
  });
});
