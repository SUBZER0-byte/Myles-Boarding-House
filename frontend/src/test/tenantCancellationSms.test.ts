import { describe, expect, it } from "vitest";
import {
  buildAdminCancellationSubmittedMessage,
  buildTenantCancellationApprovedMessage,
  buildTenantCancellationRejectedMessage,
} from "../../../supabase/functions/cancellation-sms-notifications/sms";

describe("tenant cancellation SMS messages", () => {
  const details = {
    cancellationId: 37,
    tenantName: "Jordan Reyes",
    refundAmount: 1250.5,
  };

  it("notifies Admins of the tenant name and requested refund", () => {
    expect(buildAdminCancellationSubmittedMessage(details)).toBe(
      "Cancellation request #37 submitted by Jordan Reyes. Requested refund: PHP 1,250.50. Please review the request. - Myle's Boarding House",
    );
  });

  it("notifies the tenant of approval and the recorded refund amount", () => {
    expect(buildTenantCancellationApprovedMessage(details)).toBe(
      "Jordan Reyes, cancellation request #37 was approved. A refund of PHP 1,250.50 has been recorded in your payment history. - Myle's Boarding House",
    );
  });

  it("includes a normalized rejection reason in the tenant notification", () => {
    expect(buildTenantCancellationRejectedMessage({
      ...details,
      rejectionReason: "  Outstanding balance\nmust be settled first. ",
    })).toBe(
      "Jordan Reyes, cancellation request #37 was rejected. Requested refund: PHP 1,250.50. Reason: Outstanding balance must be settled first. - Myle's Boarding House",
    );
  });

  it("requires a reason and bounds the SMS reason length", () => {
    expect(() => buildTenantCancellationRejectedMessage({ ...details, rejectionReason: " " }))
      .toThrow("A rejection reason is required");
    const message = buildTenantCancellationRejectedMessage({
      ...details,
      rejectionReason: "r".repeat(301),
    });
    expect(message).toContain(`Reason: ${"r".repeat(297)}...`);
  });
});
