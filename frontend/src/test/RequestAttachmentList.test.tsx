import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RequestAttachmentList } from "@/components/RequestAttachmentList";

describe("complaint attachments", () => {
  afterEach(() => {
    cleanup();
  });

  it("opens legacy and uploaded images in a room-style gallery, and video in its own dialog", async () => {
    render(
      <RequestAttachmentList
        legacyPhotoUrl="https://signed.example/legacy.jpg"
        attachments={[
          {
            attachment_id: 1,
            complaint_id: 9,
            path: "tenant/image.jpg",
            type: "image",
            sort_order: 0,
            signed_url: "https://signed.example/image.jpg",
          },
          {
            attachment_id: 2,
            complaint_id: 9,
            path: "tenant/video.mp4",
            type: "video",
            sort_order: 1,
            signed_url: "https://signed.example/video.mp4",
          },
        ]}
      />,
    );

    const viewImagesButton = screen.getByRole("button", { name: /View Images/ });
    expect(viewImagesButton.textContent).toContain("(2)");
    expect(screen.queryByLabelText("Complaint video preview")).toBeNull();

    fireEvent.click(viewImagesButton);
    let dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("img", { name: "Complaint image 1 of 2" }))
      .toHaveAttribute("src", "https://signed.example/legacy.jpg");
    fireEvent.click(within(dialog).getByRole("button", { name: "Next complaint image" }));
    expect(within(dialog).getByRole("img", { name: "Complaint image 2 of 2" }))
      .toHaveAttribute("src", "https://signed.example/image.jpg");
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));

    fireEvent.click(screen.getByRole("button", { name: "View Video" }));
    dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("Complaint video preview"))
      .toHaveAttribute("src", "https://signed.example/video.mp4");
  });
});
