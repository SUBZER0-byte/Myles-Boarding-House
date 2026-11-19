import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RequestAttachmentList } from "@/components/RequestAttachmentList";

describe("complaint attachments", () => {
  it("renders signed image previews and a playable optional video", () => {
    render(
      <RequestAttachmentList
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

    expect(screen.getByRole("img", { name: "Complaint image 1" }))
      .toHaveAttribute("src", "https://signed.example/image.jpg");
    expect(screen.getByLabelText("Complaint video 2"))
      .toHaveAttribute("src", "https://signed.example/video.mp4");
  });
});
