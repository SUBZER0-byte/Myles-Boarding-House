import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ImagePreview } from "@/components/ImagePreview";

describe("ImagePreview", () => {
  afterEach(() => {
    cleanup();
  });

  it("opens a full-size image dialog and supports zooming without navigation", async () => {
    render(
      <ImagePreview src="https://example.com/room.jpg" alt="Room photo">
        <span>View room photo</span>
      </ImagePreview>,
    );

    fireEvent.click(screen.getByRole("button", { name: "View image: Room photo" }));

    const dialog = await screen.findByRole("dialog");
    const image = within(dialog).getByRole("img", { name: "Room photo" });
    expect(image.getAttribute("src")).toBe("https://example.com/room.jpg");

    fireEvent.click(within(dialog).getByRole("button", { name: "Zoom in" }));
    expect(within(dialog).getByText("150%")).not.toBeNull();
    expect(within(dialog).queryByRole("link")).toBeNull();
  });

  it("uses the supplied label for text-based preview triggers", () => {
    render(
      <ImagePreview
        src="https://example.com/payment.jpg"
        alt="Payment screenshot"
        triggerLabel="View payment proof"
      >
        View payment proof
      </ImagePreview>,
    );

    expect(screen.getByRole("button", { name: "View payment proof" })).not.toBeNull();
  });
});
