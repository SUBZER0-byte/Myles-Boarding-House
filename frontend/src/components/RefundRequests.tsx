import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, RotateCcw } from "lucide-react";
import { useFinancialPolling } from "@/hooks/useFinancialPolling";
import { useToast } from "@/hooks/use-toast";
import {
  getEligibleRefundPayments,
  listMyRefundRequests,
  newFinancialRequestId,
  submitMyRefundRequest,
} from "@/lib/financialWorkflows";

interface RefundRequest {
  refund_id: number;
  payment_id: number;
  refund_amount: number;
  gcash_account_name: string;
  gcash_number: string;
  status: "Pending" | "Approved" | "Rejected";
  transaction_reference: string | null;
  transfer_reference: string | null;
  transfer_screenshot_path?: string | null;
  transfer_screenshot_url?: string | null;
  admin_note: string | null;
  description?: string | null;
  created_at: string;
}

interface EligiblePayment {
  payment_id: number;
  booking_id: number | null;
  amount: number;
  remaining_amount: number;
  method: string | null;
  reference_number: string | null;
  description: string | null;
  due_date: string | null;
  has_pending_request: number | boolean;
}

interface Props {
  paymentId?: number;
  bookingId?: number;
  onSubmitted?: () => void;
}

const peso = (amount: number) => `₱${Number(amount).toLocaleString("en-PH", { minimumFractionDigits: 2 })}`;

export function RefundRequestHistory() {
  const { data: requests, error } = useFinancialPolling<RefundRequest[]>(listMyRefundRequests, 10000);
  if (error) {
    return <div className="p-3 rounded-md border border-destructive/30 bg-destructive/10 text-destructive text-xs">{error}</div>;
  }
  if (!requests?.length) return null;
  return (
    <section className="bg-card border border-border rounded-lg p-5 space-y-3">
      <div>
        <h2 className="font-display font-semibold text-lg">Refund requests</h2>
        <p className="text-sm text-muted-foreground">Check the status of your submitted requests.</p>
      </div>
      {requests.map(request => (
        <div key={request.refund_id} className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
          <div>
            <p className="font-medium text-sm">{request.description || `Payment #${request.payment_id}`}</p>
            <p className="text-xs text-muted-foreground">{new Date(request.created_at).toLocaleDateString()} · {peso(Number(request.refund_amount))}</p>
            {request.transfer_reference && <p className="text-xs text-muted-foreground mt-1">Refund transfer transaction number: {request.transfer_reference}</p>}
            {request.transfer_screenshot_url && (
              <a
                className="text-xs text-primary underline underline-offset-4"
                href={request.transfer_screenshot_url}
                target="_blank"
                rel="noreferrer"
              >
                View refund transfer proof
              </a>
            )}
            {request.admin_note && <p className="text-xs text-muted-foreground mt-1">Admin note: {request.admin_note}</p>}
          </div>
          <Badge variant={request.status === "Approved" ? "default" : request.status === "Rejected" ? "destructive" : "secondary"}>
            {request.status}
          </Badge>
        </div>
      ))}
    </section>
  );
}

export function RefundRequestButton({ paymentId, bookingId, onSubmitted }: Props) {
  const [open, setOpen] = useState(false);
  const [reference, setReference] = useState("");
  const [gcashAccountName, setGcashAccountName] = useState("");
  const [gcashNumber, setGcashNumber] = useState("");
  const [reason, setReason] = useState("");
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [requestKey, setRequestKey] = useState(() => newFinancialRequestId());
  const [saving, setSaving] = useState(false);
  const [payments, setPayments] = useState<EligiblePayment[]>([]);
  const [selectedPaymentId, setSelectedPaymentId] = useState<number | null>(null);
  const [loadError, setLoadError] = useState("");
  const { toast } = useToast();
  const payment = payments.find(item => item.payment_id === selectedPaymentId) || null;

  useEffect(() => {
    if (!open) return;
    let active = true;
    setPayments([]);
    setSelectedPaymentId(null);
    setLoadError("");
    getEligibleRefundPayments({ payment_id: paymentId, booking_id: bookingId })
      .then(data => {
        if (!active) return;
        if (!Array.isArray(data)) {
          setLoadError("Unable to load refundable payments.");
          return;
        }
        const available = data.filter(item => !item.has_pending_request && Number(item.remaining_amount) > 0);
        setPayments(available);
        setSelectedPaymentId(available[0]?.payment_id ?? null);
        if (!available.length) setLoadError("No payment with a refundable balance is available.");
      })
      .catch(() => {
        if (active) setLoadError("Unable to load refundable payments. Please try again.");
      });
    return () => { active = false; };
  }, [open, paymentId, bookingId]);

  const submit = async () => {
    if (!payment) return;
    if (!gcashAccountName.trim() || !gcashNumber.trim()) {
      toast({ title: "Enter the GCash account name and number", variant: "destructive" });
      return;
    }
    if (!reference.trim() && !payment.reference_number && !screenshot) {
      toast({ title: "Enter a transaction number or attach a GCash screenshot", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await submitMyRefundRequest({
        payment_id: payment.payment_id,
        gcash_account_name: gcashAccountName,
        gcash_number: gcashNumber,
        transaction_reference: reference,
        reason,
        screenshot,
        idempotency_key: requestKey,
      });
      toast({ title: "Refund request submitted" });
      setOpen(false);
      setReference("");
      setGcashAccountName("");
      setGcashNumber("");
      setReason("");
      setScreenshot(null);
      setRequestKey(newFinancialRequestId());
      onSubmitted?.();
    } catch (error) {
      toast({
        title: error instanceof Error ? error.message : "Unable to submit refund request.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Button variant="outline" size="sm" className="gap-2" onClick={() => setOpen(true)}>
        <RotateCcw size={14} /> Request refund
      </Button>
      <Dialog open={open} onOpenChange={next => {
        setOpen(next);
        if (!next) {
          setReference("");
          setGcashAccountName("");
          setGcashNumber("");
          setReason("");
          setScreenshot(null);
          setRequestKey(newFinancialRequestId());
        }
      }}>
        <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Request a payment refund</DialogTitle>
            <DialogDescription>
              The refundable balance is calculated from your confirmed payment, less refunds already approved. An admin will verify your payment evidence.
            </DialogDescription>
          </DialogHeader>
          {loadError ? (
            <p className="text-sm text-destructive">{loadError}</p>
          ) : !payment ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 size={14} className="animate-spin" /> Loading payment…</div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-md bg-muted/40 p-3 text-sm">
                {payments.length > 1 && (
                  <div className="mb-3 grid gap-1.5">
                    <Label htmlFor="refund-payment">Payment to refund</Label>
                    <select
                      id="refund-payment"
                      className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                      value={payment.payment_id}
                      onChange={event => setSelectedPaymentId(Number(event.target.value))}
                    >
                      {payments.map(item => (
                        <option key={item.payment_id} value={item.payment_id}>
                          {item.description || `Payment #${item.payment_id}`} — {peso(Number(item.remaining_amount))}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <p className="font-medium">{payment.description || `Payment #${payment.payment_id}`}</p>
                <p className="text-muted-foreground mt-1">Paid: {peso(Number(payment.amount))}</p>
                <p className="font-semibold mt-1">Refund available: {peso(Number(payment.remaining_amount))}</p>
                {payment.reference_number && <p className="text-xs text-muted-foreground mt-1">Recorded transaction number: {payment.reference_number}</p>}
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="refund-gcash-name">GCash account name *</Label>
                <Input
                  id="refund-gcash-name"
                  maxLength={120}
                  autoComplete="name"
                  value={gcashAccountName}
                  onChange={event => setGcashAccountName(event.target.value)}
                  placeholder="Name registered to the GCash account"
                  required
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="refund-gcash-number">GCash number *</Label>
                <Input
                  id="refund-gcash-number"
                  type="tel"
                  maxLength={30}
                  autoComplete="tel"
                  value={gcashNumber}
                  onChange={event => setGcashNumber(event.target.value)}
                  placeholder="Number for receiving the refund"
                  required
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="refund-reference">Transaction number</Label>
                <Input id="refund-reference" maxLength={120} value={reference} onChange={event => setReference(event.target.value)} placeholder={payment.reference_number || "GCash transaction number"} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="refund-screenshot">GCash payment screenshot (optional)</Label>
                <Input id="refund-screenshot" type="file" accept="image/jpeg,image/png,image/webp" onChange={event => setScreenshot(event.target.files?.[0] || null)} />
                <p className="text-xs text-muted-foreground">JPG, PNG, or WEBP; 5MB maximum. Submit a transaction number or a screenshot.</p>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="refund-reason">Reason (optional)</Label>
                <Textarea id="refund-reason" maxLength={2000} value={reason} onChange={event => setReason(event.target.value)} rows={3} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={submit} disabled={!payment || !!loadError || saving}>
              {saving && <Loader2 size={14} className="mr-2 animate-spin" />}Submit request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
