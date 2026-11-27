import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { useTenantRatings, submitTenantRating, toast } = vi.hoisted(() => ({
  useTenantRatings: vi.fn(),
  submitTenantRating: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/components/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/hooks/useTenantRatings", () => ({ useTenantRatings }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("@/lib/tenantRatings", () => ({ submitTenantRating }));

import TenantRatings from "@/pages/tenant/TenantRatings";

describe("TenantRatings category limits", () => {
  beforeEach(() => {
    useTenantRatings.mockReturnValue({
      ratings: [{
        rating_id: 1,
        category: "Overall Satisfaction",
        moderation_status: "Revealed",
        admin_reply: null,
        stars: 4,
        comment: "Good stay",
        created_at: "2026-01-01T00:00:00.000Z",
      }],
      refetch: vi.fn(),
      error: null,
      loading: false,
    });
    submitTenantRating.mockReset().mockResolvedValue(undefined);
    toast.mockReset();
  });

  it("disables previously rated categories and locks a category after its first submission", async () => {
    render(<TenantRatings />);

    const feedback = screen.getByPlaceholderText("Share your feedback…");
    fireEvent.change(feedback, { target: { value: "Another review" } });
    expect(screen.getByRole("button", { name: "Submit Rating" })).toBeDisabled();

    fireEvent.click(screen.getByRole("combobox"));
    expect(screen.getByRole("option", { name: "Overall Satisfaction (Already rated)" }))
      .toHaveAttribute("aria-disabled", "true");
    fireEvent.click(screen.getByRole("option", { name: "Services" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit Rating" }));

    await waitFor(() => {
      expect(submitTenantRating).toHaveBeenCalledWith({
        stars: 5,
        category: "Services",
        comment: "Another review",
      });
    });

    fireEvent.click(screen.getByRole("combobox"));
    expect(screen.getByRole("option", { name: "Services (Already rated)" }))
      .toHaveAttribute("aria-disabled", "true");
  });
});
