import { DashboardLayout } from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ImagePreview } from "@/components/ImagePreview";
import { Loader2, Eye, CheckCircle2, XCircle } from "lucide-react";
import { useState } from "react";
import { useFinancialPolling } from "@/hooks/useFinancialPolling";
import { useToast } from "@/hooks/use-toast";
import {
  decideAdminRefund,
  listAdminRefundRequests,
  newFinancialRequestId,
  type RefundRequest,
} from "@/lib/financialWorkflows";

const peso = (amount: number) => `₱${Number(amount).toLocaleString("en-PH", { minimumFractionDigits: 2 })}`;

const AdminRefunds = () => {
  const { toast } = useToast();
  const { data: refunds, error, refetch } = useFinancialPolling(listAdminRefundRequests);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [transferReferences, setTransferReferences] = useState<Record<number, string>>({});
  const [transferScreenshots, setTransferScreenshots] = useState<Record<number, File | null>>({});
  const [transferScreenshotKeys, setTransferScreenshotKeys] = useState<Record<number, string>>({});
  const [busyId, setBusyId] = useState<number | null>(null);

  const decide = async (request: RefundRequest, decision: "Approved" | "Rejected") => {
    const transferReference = transferReferences[request.refund_id]?.trim() || "";
    if (decision === "Approved" && !transferReference) {
      toast({ title: "Enter the GCash transfer transaction number before approving the refund.", variant: "destructive" });
      return;
    }
    setBusyId(request.refund_id);
    try {
      await decideAdminRefund({
        refund_id: request.refund_id,
        decision,
        admin_note: notes[request.refund_id] || "",
        transfer_reference: decision === "Approved" ? transferReference : undefined,
        transfer_screenshot: decision === "Approved" ? transferScreenshots[request.refund_id] : null,
        idempotency_key: transferScreenshotKeys[request.refund_id],
      });
      toast({ title: `Refund request ${decision.toLowerCase()}` });
      refetch();
    } catch (error) {
      toast({
        title: error instanceof Error ? error.message : "Unable to update refund request.",
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <DashboardLayout role="admin">
      <div className="space-y-6">
        <div>
          <h1 className="font-display text-2xl font-bold">Refund Requests</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Verify the payment transaction number or GCash screenshot, then approve or reject the calculated refundable balance.
          </p>
        </div>
        {error && (
          <div className="p-3 rounded-md border border-destructive/30 bg-destructive/10 text-destructive text-xs">
            {error.includes("401")
              ? "Your admin session has expired. Sign out and sign back in, then reopen Refunds."
              : error}
          </div>
        )}
        {!refunds && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 size={14} className="animate-spin" /> Loading refund requests…</div>}
        {refunds?.length === 0 && <div className="bg-card border border-border rounded-lg p-8 text-center text-sm text-muted-foreground">No refund requests.</div>}
        <div className="space-y-4">
          {refunds?.map(request => (
            <article key={request.refund_id} className="bg-card border border-border rounded-lg p-5 space-y-4">
              <header className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold">{request.payer_name || request.payer_email || `User #${request.user_id}`}</h2>
                  <p className="text-xs text-muted-foreground">
                    {request.payer_email || "—"} · {request.booking_id ? `Booking #${request.booking_id}` : `Payment #${request.payment_id}`}
                  </p>
                </div>
                <Badge variant={request.status === "Approved" ? "default" : request.status === "Rejected" ? "destructive" : "secondary"}>
                  {request.status}
                </Badge>
              </header>
              <div className="grid gap-3 sm:grid-cols-3 text-sm">
                <div className="rounded-md bg-muted/40 p-3">
                  <p className="text-xs text-muted-foreground">Paid payment</p>
                  <p className="font-semibold">{peso(Number(request.payment_amount))}</p>
                  <p className="text-xs text-muted-foreground mt-1">{request.description || request.payment_type || "Payment"}{request.due_date ? ` · ${request.due_date}` : ""}</p>
                </div>
                <div className="rounded-md bg-primary/5 border border-primary/15 p-3">
                  <p className="text-xs text-muted-foreground">Calculated refund</p>
                  <p className="font-semibold text-primary">{peso(Number(request.refund_amount))}</p>
                </div>
                <div className="rounded-md bg-muted/40 p-3">
                  <p className="text-xs text-muted-foreground">Payment method</p>
                  <p className="font-semibold">{request.method || "—"}</p>
                  <p className="text-xs text-muted-foreground mt-1">Recorded: {request.reference_number || "No transaction number on payment"}</p>
                </div>
              </div>
              <div className="grid gap-2 text-sm">
                <p><span className="text-muted-foreground">Submitted transaction number:</span> {request.transaction_reference || "—"}</p>
                <p><span className="text-muted-foreground">Refund GCash account name:</span> {request.gcash_account_name || "—"}</p>
                <p><span className="text-muted-foreground">Refund GCash number:</span> {request.gcash_number || "—"}</p>
                <p><span className="text-muted-foreground">Request reason:</span> {request.reason || "Not provided"}</p>
                <p className="text-xs text-muted-foreground">Requested {new Date(request.created_at).toLocaleString()}</p>
                {request.screenshot_url && (
                  <ImagePreview
                    src={request.screenshot_url}
                    alt="GCash payment screenshot"
                    triggerLabel="View GCash screenshot"
                    triggerClassName="inline-flex w-fit items-center gap-2 text-primary underline underline-offset-4"
                  >
                    <Eye size={14} /> View GCash screenshot
                  </ImagePreview>
                )}
                {request.transfer_reference && <p><span className="text-muted-foreground">Refund transfer transaction number:</span> {request.transfer_reference}</p>}
                {request.transfer_screenshot_url && (
                  <ImagePreview
                    src={request.transfer_screenshot_url}
                    alt="Refund transfer proof"
                    triggerLabel="View refund transfer proof"
                    triggerClassName="inline-flex w-fit items-center gap-2 text-primary underline underline-offset-4"
                  >
                    <Eye size={14} /> View refund transfer proof
                  </ImagePreview>
                )}
                {request.admin_note && <p className="text-sm"><span className="text-muted-foreground">Admin note:</span> {request.admin_note}</p>}
              </div>
              {request.status === "Pending" && (
                <div className="space-y-3 border-t border-border pt-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor={`refund-transfer-reference-${request.refund_id}`}>GCash transfer transaction number *</Label>
                      <Input
                        id={`refund-transfer-reference-${request.refund_id}`}
                        maxLength={120}
                        autoComplete="off"
                        value={transferReferences[request.refund_id] || ""}
                        onChange={event => setTransferReferences(current => ({ ...current, [request.refund_id]: event.target.value }))}
                        placeholder="Enter the transfer reference"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`refund-transfer-screenshot-${request.refund_id}`}>GCash transfer screenshot (optional)</Label>
                      <Input
                        id={`refund-transfer-screenshot-${request.refund_id}`}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        onChange={event => {
                          setTransferScreenshots(current => ({
                            ...current,
                            [request.refund_id]: event.target.files?.[0] || null,
                          }));
                          setTransferScreenshotKeys(current => ({
                            ...current,
                            [request.refund_id]: newFinancialRequestId(),
                          }));
                        }}
                      />
                      <p className="text-xs text-muted-foreground">JPG, PNG, or WEBP; maximum 5MB.</p>
                    </div>
                  </div>
                  <Textarea
                    maxLength={2000}
                    rows={2}
                    placeholder="Optional note to the requester"
                    value={notes[request.refund_id] || ""}
                    onChange={event => setNotes(current => ({ ...current, [request.refund_id]: event.target.value }))}
                  />
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button variant="destructive" onClick={() => decide(request, "Rejected")} disabled={busyId === request.refund_id}>
                      {busyId === request.refund_id ? <Loader2 size={14} className="mr-2 animate-spin" /> : <XCircle size={14} className="mr-2" />}Reject
                    </Button>
                    <Button onClick={() => decide(request, "Approved")} disabled={busyId === request.refund_id}>
                      {busyId === request.refund_id ? <Loader2 size={14} className="mr-2 animate-spin" /> : <CheckCircle2 size={14} className="mr-2" />}Approve refund
                    </Button>
                  </div>
                </div>
              )}
            </article>
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
};

export default AdminRefunds;
