import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  useFinancialPolling,
  useAuth,
  getEligibleRefundPayments,
  submitMyRefundRequest,
  toast,
} = vi.hoisted(() => ({
  useFinancialPolling: vi.fn(),
  useAuth: vi.fn(),
  getEligibleRefundPayments: vi.fn(),
  submitMyRefundRequest: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/hooks/useFinancialPolling", () => ({ useFinancialPolling }));
vi.mock("@/lib/AuthProvider", () => ({ useAuth }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("@/lib/financialWorkflows", () => ({
  getEligibleRefundPayments,
  listMyRefundRequests: vi.fn(),
  newFinancialRequestId: vi.fn(() => "refund-test-key"),
  submitMyRefundRequest,
}));

import { RefundRequestButton, RefundRequestHistory } from "@/components/RefundRequests";

describe("RefundRequestHistory screenshot preview", () => {
  beforeEach(() => {
    useAuth.mockReturnValue({ profile: { phone: "09123456789" } });
    getEligibleRefundPayments.mockReset().mockResolvedValue([{
      payment_id: 2,
      booking_id: null,
      amount: 100,
      remaining_amount: 100,
      payment_type: "Security Deposit",
      method: "GCash",
      reference_number: "txn-2",
      description: "Security deposit",
      due_date: null,
      has_pending_request: false,
    }]);
    submitMyRefundRequest.mockReset().mockResolvedValue(undefined);
    toast.mockReset();
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

  it("defaults the GCash number to the account phone and submits only the sanitized local number", async () => {
    render(<RefundRequestButton paymentId={2} />);
    fireEvent.click(screen.getByRole("button", { name: "Request refund" }));

    const numberInput = await screen.findByLabelText("GCash number *");
    expect(numberInput).toHaveValue("09123456789");
    fireEvent.change(numberInput, { target: { value: "09abc123456789" } });
    expect(numberInput).toHaveValue("09123456789");
    fireEvent.change(screen.getByLabelText("GCash account name *"), { target: { value: "Test User" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit request" }));

    await waitFor(() => {
      expect(submitMyRefundRequest).toHaveBeenCalledWith(expect.objectContaining({
        gcash_number: "09123456789",
      }));
    });
  });

  it("rejects refund numbers outside the Philippine mobile format", async () => {
    render(<RefundRequestButton paymentId={2} />);
    fireEvent.click(screen.getByRole("button", { name: "Request refund" }));

    const numberInput = await screen.findByLabelText("GCash number *");
    fireEvent.change(numberInput, { target: { value: "12345678901" } });
    fireEvent.change(screen.getByLabelText("GCash account name *"), { target: { value: "Test User" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit request" }));

    expect(submitMyRefundRequest).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith({
      title: "Enter a valid Philippine mobile number (09XXXXXXXXX)",
      variant: "destructive",
    });
  });
});
