import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { useFinancialPolling, toast } = vi.hoisted(() => ({
  useFinancialPolling: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/components/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/hooks/useFinancialPolling", () => ({ useFinancialPolling }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("@/lib/financialWorkflows", () => ({
  decideAdminRefund: vi.fn(),
  listAdminRefundRequests: vi.fn(),
  newFinancialRequestId: vi.fn(),
}));

import AdminRefunds from "@/pages/admin/AdminRefunds";

describe("AdminRefunds screenshot preview", () => {
  beforeEach(() => {
    useFinancialPolling.mockReturnValue({
      data: [{
        refund_id: 1,
        payment_id: 2,
        user_id: 3,
        refund_amount: 100,
        gcash_account_name: "Test User",
        gcash_number: "09123456789",
        transaction_reference: "transaction-123",
        screenshot_url: "https://example.com/payment-proof.jpg",
        transfer_reference: "refund-456",
        transfer_screenshot_url: "https://example.com/refund-proof.jpg",
        reason: "Test refund",
        status: "Approved",
        admin_note: null,
        created_at: "2026-01-01T00:00:00.000Z",
        payment_amount: 100,
        method: "GCash",
        reference_number: "payment-789",
        description: "Monthly rent",
        payment_type: "Rent",
        booking_id: 4,
        due_date: null,
        payer_name: "Test User",
        payer_email: "test@example.com",
      }],
      error: null,
      refetch: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("shows the submitted GCash screenshot in a dialog without opening a new tab", async () => {
    render(<AdminRefunds />);

    fireEvent.click(screen.getByRole("button", { name: "View GCash screenshot" }));

    const dialog = await screen.findByRole("dialog");
    const image = within(dialog).getByRole("img", { name: "GCash payment screenshot" });
    expect(image.getAttribute("src")).toBe("https://example.com/payment-proof.jpg");
    expect(within(dialog).queryByRole("link")).toBeNull();
  });

  it("shows the refund transfer proof in the same-page dialog", async () => {
    render(<AdminRefunds />);

    fireEvent.click(screen.getByRole("button", { name: "View refund transfer proof" }));

    const dialog = await screen.findByRole("dialog");
    const image = within(dialog).getByRole("img", { name: "Refund transfer proof" });
    expect(image.getAttribute("src")).toBe("https://example.com/refund-proof.jpg");
    expect(within(dialog).queryByRole("link")).toBeNull();
  });
});
