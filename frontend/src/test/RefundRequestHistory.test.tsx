import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { useFinancialPolling } = vi.hoisted(() => ({
  useFinancialPolling: vi.fn(),
}));

vi.mock("@/hooks/useFinancialPolling", () => ({ useFinancialPolling }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/financialWorkflows", () => ({
  getEligibleRefundPayments: vi.fn(),
  listMyRefundRequests: vi.fn(),
  newFinancialRequestId: vi.fn(),
  submitMyRefundRequest: vi.fn(),
}));

import { RefundRequestHistory } from "@/components/RefundRequests";

describe("RefundRequestHistory screenshot preview", () => {
  beforeEach(() => {
    useFinancialPolling.mockReturnValue({
      data: [{
        refund_id: 1,
        payment_id: 2,
        refund_amount: 100,
        gcash_account_name: "Test User",
        gcash_number: "09123456789",
        status: "Approved",
        transaction_reference: "transaction-123",
        transfer_reference: "refund-456",
        transfer_screenshot_url: "https://example.com/refund-proof.jpg",
        admin_note: null,
        description: "Monthly rent",
        created_at: "2026-01-01T00:00:00.000Z",
      }],
      error: null,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("shows refund proof in a dialog without opening a new tab", async () => {
    render(<RefundRequestHistory />);

    fireEvent.click(screen.getByRole("button", { name: "View refund transfer proof" }));

    const dialog = await screen.findByRole("dialog");
    const image = within(dialog).getByRole("img", { name: "Refund transfer proof" });
    expect(image.getAttribute("src")).toBe("https://example.com/refund-proof.jpg");
    expect(within(dialog).queryByRole("link")).toBeNull();
  });
});
