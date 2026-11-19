// Runtime validation coverage for promotional video discussion access and actions.
import type { ButtonHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  addPromotionalVideoComment,
  addPromotionalVideoReply,
  deleteMyPromotionalVideoComment,
  deleteMyPromotionalVideoReply,
  getPromotionalVideoDiscussion,
  togglePromotionalVideoLike,
  togglePromotionalVideoDiscussionLike,
  updateMyPromotionalVideoComment,
  updateMyPromotionalVideoReply,
  profile,
} = vi.hoisted(() => ({
  addPromotionalVideoComment: vi.fn(),
  addPromotionalVideoReply: vi.fn(),
  deleteMyPromotionalVideoComment: vi.fn(),
  deleteMyPromotionalVideoReply: vi.fn(),
  getPromotionalVideoDiscussion: vi.fn(),
  togglePromotionalVideoLike: vi.fn(),
  togglePromotionalVideoDiscussionLike: vi.fn(),
  updateMyPromotionalVideoComment: vi.fn(),
  updateMyPromotionalVideoReply: vi.fn(),
  profile: { current: null as null | { user_id: number; full_name: string } },
}));

vi.mock("@/components/ui/button", () => ({
  buttonVariants: () => "",
  Button: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) => (
    <button {...props}>{children}</button>
  ),
}));
vi.mock("@/components/ui/textarea", () => ({
  Textarea: (props: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...props} />,
}));
vi.mock("@/lib/AuthProvider", () => ({
  useAuth: () => ({ profile: profile.current, loading: false }),
}));
vi.mock("@/lib/promotionalVideo", () => ({
  addPromotionalVideoComment,
  addPromotionalVideoReply,
  deleteMyPromotionalVideoComment,
  deleteMyPromotionalVideoReply,
  getPromotionalVideoDiscussion,
  togglePromotionalVideoLike,
  togglePromotionalVideoDiscussionLike,
  updateMyPromotionalVideoComment,
  updateMyPromotionalVideoReply,
}));

import { PromotionalVideoDiscussion } from "@/components/PromotionalVideoDiscussion";

describe("promotional video discussion UI", () => {
  beforeEach(() => {
    profile.current = null;
    getPromotionalVideoDiscussion.mockReset().mockResolvedValue({
      video_url: "https://www.youtube.com/watch?v=abcdefghijk",
      likes_count: 2,
      comments_count: 2,
      liked_by_me: false,
      comments: [{
        comment_id: 4,
        full_name: "A Tenant",
        comment: "Great video",
        created_at: "2026-11-18T12:00:00Z",
        is_mine: true,
        replies_count: 0,
        likes_count: 1,
        liked_by_me: false,
        replies: [],
      }, {
        comment_id: 5,
        full_name: "Another Tenant",
        comment: "Another perspective",
        created_at: "2026-11-18T11:00:00Z",
        is_mine: false,
        replies_count: 1,
        likes_count: 2,
        liked_by_me: false,
        replies: [{
          reply_id: 14,
          full_name: "Replying Guest",
          reply: "Thanks for sharing this.",
          created_at: "2026-11-18T11:30:00Z",
          is_mine: false,
          likes_count: 1,
          liked_by_me: false,
        }],
      }],
    });
    addPromotionalVideoComment.mockReset().mockResolvedValue(undefined);
    addPromotionalVideoReply.mockReset().mockResolvedValue(undefined);
    deleteMyPromotionalVideoComment.mockReset().mockResolvedValue("Comment deleted.");
    deleteMyPromotionalVideoReply.mockReset().mockResolvedValue("Reply deleted.");
    togglePromotionalVideoLike.mockReset().mockResolvedValue({ liked: true, likes_count: 3 });
    togglePromotionalVideoDiscussionLike.mockReset().mockResolvedValue(undefined);
    updateMyPromotionalVideoComment.mockReset().mockResolvedValue("Comment updated.");
    updateMyPromotionalVideoReply.mockReset().mockResolvedValue("Reply updated.");
  });

  afterEach(() => cleanup());

  it("shows comments and requires sign-in for posting and liking", async () => {
    render(<BrowserRouter><PromotionalVideoDiscussion /></BrowserRouter>);

    expect(await screen.findByText("Great video")).toBeTruthy();
    expect(screen.getByText("Another perspective")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit my comment" })).toBeNull();
    expect(screen.getByTitle("Myle's Boarding House promotional video").getAttribute("src"))
      .toBe("https://www.youtube.com/embed/abcdefghijk");
    expect(screen.getByText("Sign in")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign in to like video" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Like comment (2)" })).toBeDisabled();
    expect(screen.getAllByText("Sign in to like")).toHaveLength(2);
    expect(screen.queryByLabelText("Add a comment")).toBeNull();
    expect(screen.queryByText("Thanks for sharing this.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show replies (1)" }));
    expect(screen.getByText("Thanks for sharing this.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Hide replies" }));
    expect(screen.queryByText("Thanks for sharing this.")).toBeNull();
  });

  it("censors profane words in public comments and replies", async () => {
    getPromotionalVideoDiscussion.mockReset().mockResolvedValue({
      video_url: "https://www.youtube.com/watch?v=abcdefghijk",
      likes_count: 0,
      comments_count: 1,
      liked_by_me: false,
      comments: [{
        comment_id: 1,
        full_name: "A Tenant",
        comment: "The FUCK is shit.",
        created_at: "2026-11-18T12:00:00Z",
        is_mine: false,
        replies_count: 1,
        likes_count: 0,
        liked_by_me: false,
        replies: [{
          reply_id: 2,
          full_name: "Another Tenant",
          reply: "What the hell!",
          created_at: "2026-11-18T13:00:00Z",
          is_mine: false,
          likes_count: 0,
          liked_by_me: false,
        }],
      }],
    });

    render(<BrowserRouter><PromotionalVideoDiscussion /></BrowserRouter>);
    expect(await screen.findByText("The **** is ****.")).toBeTruthy();
    expect(screen.queryByText("The FUCK is shit.")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show replies (1)" }));
    expect(screen.getByText("What the ****!")).toBeTruthy();
    expect(screen.queryByText("What the hell!")).toBeNull();
  });

  it("lets a signed-in user like the video and post a comment", async () => {
    profile.current = { user_id: 7, full_name: "A Tenant" };
    render(<BrowserRouter><PromotionalVideoDiscussion /></BrowserRouter>);

    const likeButton = await screen.findByRole("button", { name: "Like video" });
    fireEvent.click(likeButton);
    await waitFor(() => expect(togglePromotionalVideoLike).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText("Add a comment"), {
      target: { value: "Thanks for sharing!" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Post comment" }));

    await waitFor(() => expect(addPromotionalVideoComment).toHaveBeenCalledWith("Thanks for sharing!"));
  });

  it("allows a user to edit and delete only comments marked as their own", async () => {
    profile.current = { user_id: 7, full_name: "A Tenant" };
    render(<BrowserRouter><PromotionalVideoDiscussion /></BrowserRouter>);

    expect(await screen.findByText("Great video")).toBeTruthy();
    expect(screen.getByText("Another perspective")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Edit my comment" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Edit my comment" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Edit comment" }), {
      target: { value: "Updated review" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(updateMyPromotionalVideoComment).toHaveBeenCalledWith(4, "Updated review"));

    fireEvent.click(screen.getByRole("button", { name: "Delete my comment" }));
    expect(await screen.findByText("Delete your comment?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete comment" }));
    await waitFor(() => expect(deleteMyPromotionalVideoComment).toHaveBeenCalledWith(4));
  });

  it("allows signed-in users to reply to another user's comment", async () => {
    profile.current = { user_id: 7, full_name: "A Tenant" };
    render(<BrowserRouter><PromotionalVideoDiscussion /></BrowserRouter>);

    expect(await screen.findByText("Another perspective")).toBeTruthy();
    expect(screen.queryByText("Thanks for sharing this.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Reply$/ }));
    const replyBox = screen.getByLabelText("Reply to Another Tenant");
    fireEvent.change(replyBox, { target: { value: "Thanks for sharing!" } });
    fireEvent.click(screen.getByRole("button", { name: "Post reply" }));

    await waitFor(() => expect(addPromotionalVideoReply).toHaveBeenCalledWith(5, "Thanks for sharing!"));
  });

  it("allows users to edit and delete only their own replies", async () => {
    profile.current = { user_id: 7, full_name: "A Tenant" };
    getPromotionalVideoDiscussion.mockReset().mockResolvedValue({
      video_url: "https://www.youtube.com/watch?v=abcdefghijk",
      likes_count: 2,
      comments_count: 1,
      liked_by_me: false,
      comments: [{
        comment_id: 5,
        full_name: "Another Tenant",
        comment: "Another perspective",
        created_at: "2026-11-18T11:00:00Z",
        is_mine: false,
        replies_count: 2,
        likes_count: 0,
        liked_by_me: false,
        replies: [{
          reply_id: 14,
          full_name: "A Tenant",
          reply: "My reply",
          created_at: "2026-11-18T11:30:00Z",
          is_mine: true,
          likes_count: 0,
          liked_by_me: false,
        }, {
          reply_id: 15,
          full_name: "Another Guest",
          reply: "Someone else's reply",
          created_at: "2026-11-18T11:45:00Z",
          is_mine: false,
          likes_count: 0,
          liked_by_me: false,
        }],
      }],
    });

    render(<BrowserRouter><PromotionalVideoDiscussion /></BrowserRouter>);
    fireEvent.click(await screen.findByRole("button", { name: "Show replies (2)" }));
    expect(await screen.findByText("My reply")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Edit my reply" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Delete my reply" })).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Edit my reply" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Edit reply" }), {
      target: { value: "Updated reply" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => {
      expect(updateMyPromotionalVideoReply).toHaveBeenCalledWith(14, "Updated reply");
    });

    fireEvent.click(screen.getByRole("button", { name: "Delete my reply" }));
    expect(await screen.findByText("Delete your reply?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete reply" }));
    await waitFor(() => expect(deleteMyPromotionalVideoReply).toHaveBeenCalledWith(14));
  });

  it("allows signed-in users to like comments and replies", async () => {
    profile.current = { user_id: 7, full_name: "A Tenant" };
    render(<BrowserRouter><PromotionalVideoDiscussion /></BrowserRouter>);

    expect(await screen.findByText("Another perspective")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Like comment (2)" }));
    await waitFor(() => {
      expect(togglePromotionalVideoDiscussionLike).toHaveBeenCalledWith("comment", 5);
    });

    fireEvent.click(screen.getByRole("button", { name: "Show replies (1)" }));
    expect(await screen.findByText("Thanks for sharing this.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Like reply (1)" }));
    await waitFor(() => {
      expect(togglePromotionalVideoDiscussionLike).toHaveBeenCalledWith("reply", 14);
    });
  });
});
