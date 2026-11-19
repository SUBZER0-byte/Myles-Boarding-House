import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  deleteAdminPromotionalVideoComment,
  deleteAdminPromotionalVideoLike,
  deleteAdminPromotionalVideoReply,
  listAdminPromotionalVideo,
  saveAdminPromotionalVideoUrl,
  toast,
} = vi.hoisted(() => ({
  deleteAdminPromotionalVideoComment: vi.fn(),
  deleteAdminPromotionalVideoLike: vi.fn(),
  deleteAdminPromotionalVideoReply: vi.fn(),
  listAdminPromotionalVideo: vi.fn(),
  saveAdminPromotionalVideoUrl: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/components/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast }),
}));
vi.mock("@/lib/promotionalVideo", () => ({
  deleteAdminPromotionalVideoComment,
  deleteAdminPromotionalVideoLike,
  deleteAdminPromotionalVideoReply,
  listAdminPromotionalVideo,
  saveAdminPromotionalVideoUrl,
}));

import AdminPromotionalVideo from "@/pages/admin/AdminPromotionalVideo";

describe("Admin promotional video management", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listAdminPromotionalVideo.mockResolvedValue({
      video_url: "https://www.youtube.com/watch?v=abcdefghijk",
      comments: [{
        comment_id: 12,
        user_id: 4,
        full_name: "Guest User",
        username: "guest",
        comment: "A nice place",
        created_at: "2026-11-18T12:00:00Z",
      }],
      replies: [{
        reply_id: 18,
        comment_id: 12,
        full_name: "Another Guest",
        username: "anotherguest",
        reply: "I agree!",
        created_at: "2026-11-18T13:00:00Z",
        likes_count: 2,
        comment: "A nice place",
        commenter_name: "Guest User",
      }],
      likes: [{
        user_id: 4,
        full_name: "Guest User",
        username: "guest",
        created_at: "2026-11-18T12:00:00Z",
      }],
    });
    saveAdminPromotionalVideoUrl.mockResolvedValue("Promotional video URL saved.");
    deleteAdminPromotionalVideoComment.mockResolvedValue("Comment deleted.");
    deleteAdminPromotionalVideoLike.mockResolvedValue("Like removed.");
    deleteAdminPromotionalVideoReply.mockResolvedValue("Reply deleted.");
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("previews and saves a changed video URL, and offers comment and like moderation", async () => {
    render(<AdminPromotionalVideo />);

    expect(await screen.findByText("A nice place")).toBeTruthy();
    expect(await screen.findByText("I agree!")).toBeTruthy();
    expect(screen.getByText("Reply to Guest User: “A nice place”")).toBeTruthy();
    expect(screen.getByTitle("Promotional video preview").getAttribute("src"))
      .toBe("https://www.youtube.com/embed/abcdefghijk");

    fireEvent.change(screen.getByLabelText("YouTube video URL"), {
      target: { value: "https://youtu.be/lmnopqrstuv" },
    });
    expect(screen.getByTitle("Promotional video preview").getAttribute("src"))
      .toBe("https://www.youtube.com/embed/lmnopqrstuv");
    fireEvent.click(screen.getByRole("button", { name: "Save video" }));
    await waitFor(() => {
      expect(saveAdminPromotionalVideoUrl).toHaveBeenCalledWith("https://youtu.be/lmnopqrstuv");
    });

    fireEvent.click(screen.getByRole("button", { name: "Delete comment by Guest User" }));
    expect(await screen.findByText("Delete this comment?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(deleteAdminPromotionalVideoComment).toHaveBeenCalledWith(12));

    fireEvent.click(screen.getByRole("button", { name: "Delete reply by Another Guest" }));
    expect(await screen.findByText("Delete this reply?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(deleteAdminPromotionalVideoReply).toHaveBeenCalledWith(18));

    fireEvent.click(screen.getByRole("button", { name: "Remove like by Guest User" }));
    expect(await screen.findByText("Remove this like?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(deleteAdminPromotionalVideoLike).toHaveBeenCalledWith(4));
  });

  it("automatically reloads management data without replacing an unsaved video URL", async () => {
    const initialData = {
      video_url: "https://www.youtube.com/watch?v=abcdefghijk",
      comments: [{
        comment_id: 12,
        user_id: 4,
        full_name: "Guest User",
        username: "guest",
        comment: "A nice place",
        created_at: "2026-11-18T12:00:00Z",
      }],
      replies: [],
      likes: [],
    };
    const refreshedData = {
      ...initialData,
      video_url: "https://youtu.be/lmnopqrstuv",
      comments: [{
        ...initialData.comments[0],
        comment: "Posted by another user",
      }],
    };
    listAdminPromotionalVideo.mockReset()
      .mockResolvedValueOnce(initialData)
      .mockResolvedValue(refreshedData);
    vi.useFakeTimers();
    render(<AdminPromotionalVideo />);

    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText("A nice place")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("YouTube video URL"), {
      target: { value: "https://youtu.be/zyxwvutsrq1" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(screen.getByText("Posted by another user")).toBeTruthy();
    expect(screen.getByLabelText("YouTube video URL")).toHaveValue("https://youtu.be/zyxwvutsrq1");
    expect(listAdminPromotionalVideo).toHaveBeenCalledTimes(2);
  });
});
