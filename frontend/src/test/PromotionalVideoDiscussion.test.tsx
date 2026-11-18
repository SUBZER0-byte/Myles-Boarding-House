// Runtime validation coverage for promotional video discussion access and actions.
import type { ButtonHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  addPromotionalVideoComment,
  deleteMyPromotionalVideoComment,
  getPromotionalVideoDiscussion,
  togglePromotionalVideoLike,
  updateMyPromotionalVideoComment,
  profile,
} = vi.hoisted(() => ({
  addPromotionalVideoComment: vi.fn(),
  deleteMyPromotionalVideoComment: vi.fn(),
  getPromotionalVideoDiscussion: vi.fn(),
  togglePromotionalVideoLike: vi.fn(),
  updateMyPromotionalVideoComment: vi.fn(),
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
  deleteMyPromotionalVideoComment,
  getPromotionalVideoDiscussion,
  togglePromotionalVideoLike,
  updateMyPromotionalVideoComment,
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
      }, {
        comment_id: 5,
        full_name: "Another Tenant",
        comment: "Another perspective",
        created_at: "2026-11-18T11:00:00Z",
        is_mine: false,
      }],
    });
    addPromotionalVideoComment.mockReset().mockResolvedValue(undefined);
    deleteMyPromotionalVideoComment.mockReset().mockResolvedValue("Comment deleted.");
    togglePromotionalVideoLike.mockReset().mockResolvedValue({ liked: true, likes_count: 3 });
    updateMyPromotionalVideoComment.mockReset().mockResolvedValue("Comment updated.");
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
    expect(screen.queryByLabelText("Add a comment")).toBeNull();
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
});
