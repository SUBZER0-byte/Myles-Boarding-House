import {
  normalizePhilippineSmsPhone,
  sendTextBeeSms,
} from "../rent-payment-reminders/sms.ts";

export { normalizePhilippineSmsPhone, sendTextBeeSms };

interface CancellationSmsDetails {
  cancellationId: number;
  tenantName: string;
  refundAmount: number;
}

function formatCancellationDetails({ cancellationId, tenantName, refundAmount }: CancellationSmsDetails) {
  const name = tenantName.trim();
  if (
    !Number.isSafeInteger(cancellationId)
    || cancellationId < 1
    || !name
    || !Number.isFinite(refundAmount)
    || refundAmount < 0
  ) {
    throw new Error("Cancellation SMS details are invalid.");
  }
  const amount = new Intl.NumberFormat("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(refundAmount);
  return { name, amount };
}

export function buildAdminCancellationSubmittedMessage(details: CancellationSmsDetails): string {
  const { name, amount } = formatCancellationDetails(details);
  return `Cancellation request #${details.cancellationId} submitted by ${name}. Requested refund: PHP ${amount}. Please review the request. - Myle's Boarding House`;
}

export function buildTenantCancellationApprovedMessage(details: CancellationSmsDetails): string {
  const { name, amount } = formatCancellationDetails(details);
  return `${name}, cancellation request #${details.cancellationId} was approved. A refund of PHP ${amount} has been recorded in your payment history. - Myle's Boarding House`;
}

export function buildTenantCancellationRejectedMessage(
  details: CancellationSmsDetails & { rejectionReason: string },
): string {
  const { name, amount } = formatCancellationDetails(details);
  const normalizedReason = details.rejectionReason.trim().replace(/\s+/g, " ");
  if (!normalizedReason) {
    throw new Error("A rejection reason is required for the cancellation SMS.");
  }
  const reason = normalizedReason.length > 300
    ? `${normalizedReason.slice(0, 297)}...`
    : normalizedReason;
  return `${name}, cancellation request #${details.cancellationId} was rejected. Requested refund: PHP ${amount}. Reason: ${reason} - Myle's Boarding House`;
}
