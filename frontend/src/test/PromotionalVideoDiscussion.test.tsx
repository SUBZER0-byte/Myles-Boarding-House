// Runtime validation coverage for promotional video discussion access and actions.
import type { ButtonHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  addPromotionalVideoComment,
  getPromotionalVideoDiscussion,
  togglePromotionalVideoLike,
  profile,
} = vi.hoisted(() => ({
  addPromotionalVideoComment: vi.fn(),
  getPromotionalVideoDiscussion: vi.fn(),
  togglePromotionalVideoLike: vi.fn(),
  profile: { current: null as null | { full_name: string } },
}));

vi.mock("@/components/ui/button", () => ({
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
  getPromotionalVideoDiscussion,
  togglePromotionalVideoLike,
}));

import { PromotionalVideoDiscussion } from "@/components/PromotionalVideoDiscussion";

describe("promotional video discussion UI", () => {
  beforeEach(() => {
    profile.current = null;
    getPromotionalVideoDiscussion.mockReset().mockResolvedValue({
      likes_count: 2,
      liked_by_me: false,
      comments: [{
        comment_id: 4,
        full_name: "A Tenant",
        comment: "Great video",
        created_at: "2026-11-18T12:00:00Z",
      }],
    });
    addPromotionalVideoComment.mockReset().mockResolvedValue(undefined);
    togglePromotionalVideoLike.mockReset().mockResolvedValue({ liked: true, likes_count: 3 });
  });

  afterEach(() => cleanup());

  it("shows comments and requires sign-in for posting and liking", async () => {
    render(<BrowserRouter><PromotionalVideoDiscussion /></BrowserRouter>);

    expect(await screen.findByText("Great video")).toBeTruthy();
    expect(screen.getByText("Sign in")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign in to like video" })).toBeDisabled();
    expect(screen.queryByLabelText("Add a comment")).toBeNull();
  });

  it("lets a signed-in user like the video and post a comment", async () => {
    profile.current = { full_name: "A Tenant" };
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
});
