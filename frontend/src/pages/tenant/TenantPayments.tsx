import { DashboardLayout } from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CreditCard, Loader2, CheckCircle2, Download, Wallet, XCircle } from "lucide-react";
import { useRef, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { useSupabasePolling } from "@/hooks/useSupabasePolling";
import { useFinancialPolling } from "@/hooks/useFinancialPolling";
import { sessionStore } from "@/lib/api";
import { BookingPaymentDialog } from "@/components/BookingPaymentDialog";
import { RefundRequestButton, RefundRequestHistory } from "@/components/RefundRequests";
import {
  listMyRentPayments,
  newRentPaymentSubmissionId,
  submitMyRentPayment,
  type RentPayment,
} from "@/lib/rentPayments";
import {
  cancelMyFullPayment,
  getMyFullPaymentPreview,
  getMyFullPaymentRequest,
  newFinancialRequestId,
  requestMyFullPayment,
  submitMyFullPaymentProof,
} from "@/lib/financialWorkflows";

type Payment = RentPayment;

interface FullPaymentInstallment {
  payment_id: number;
  amount: number;
  due_date: string | null;
  description: string | null;
  status: string;
}

interface FullPaymentPreview {
  total_amount: number;
  installments: FullPaymentInstallment[];
  eligible: boolean;
}

interface FullPaymentRequest {
  request_id: number;
  total_amount: number;
  status: "Requested" | "Approved" | "Rejected" | "Submitted" | "Confirmed" | "Cancelled";
  admin_note: string | null;
  reference_number: string | null;
  qr_url: string | null;
  installments: FullPaymentInstallment[];
}

type PaymentFilter = "All" | "Paid" | "Overdue" | "Pending" | "Other";

const peso = (n: number) => "₱" + Number(n).toLocaleString();
const isPaid = (status: string) => status === "Paid" || status === "Confirmed";
const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const statusLabel = (status: string, dueDate?: string | null) => {
  if (status === "Confirmed") return "Paid";
  if ((status === "Pending" || status === "Overdue") && dueDate && dueDate.slice(0, 10) < today()) {
    return "Overdue";
  }
  return status;
};

const isRefunded = (payment: Payment) =>
  isPaid(payment.status)
  && Number(payment.amount) > 0
  && Number(payment.refunded_amount || 0) >= Number(payment.amount);
const paymentStatusLabel = (payment: Payment) =>
  isRefunded(payment) ? "Refunded" : statusLabel(payment.status, payment.due_date);

const paymentCategory = (payment: Payment): Exclude<PaymentFilter, "All"> => {
  const label = paymentStatusLabel(payment);
  if (label === "Paid") return "Paid";
  if (label === "Overdue") return "Overdue";
  if (label === "Pending" || label === "Submitted") return "Pending";
  return "Other";
};

const dateLabel = (value: string | null | undefined) => {
  if (!value) return "";
  const datePart = value.slice(0, 10);
  const [year, month, day] = datePart.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" });
};

const monthLabel = (value: string | null) => {
  if (!value) return "Period unavailable";
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-PH", { month: "long", year: "numeric" });
};

const pdfSafe = (value: string) =>
  value.normalize("NFKD").replace(/[^\x20-\x7E]/g, "").slice(0, 92).replace(/[\\()]/g, "\\$&");

const downloadPaymentPdf = (payments: Payment[], tenantName: string) => {
  const stayPeriods = [...new Set(payments
    .filter(p => p.check_in_date && p.check_out_date)
    .map(p => `${dateLabel(p.check_in_date)} to ${dateLabel(p.check_out_date)}`))];
  const lines = [
    "MYLE'S BOARDING HOUSE",
    "TENANT PAYMENT RECORD",
    "",
    `Tenant: ${tenantName}`,
    `Stay period${stayPeriods.length === 1 ? "" : "s"}: ${stayPeriods.join("; ") || "Not available"}`,
    `Generated: ${new Date().toLocaleString("en-PH")}`,
    "",
    "MONTH / PERIOD            DUE DATE       STATUS         AMOUNT",
    "---------------------------------------------------------------------",
  ];

  [...payments].sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? "")).forEach(payment => {
    const period = monthLabel(payment.due_date);
    lines.push(
      `${period.padEnd(25).slice(0, 25)} ${dateLabel(payment.due_date).padEnd(14).slice(0, 14)} ${paymentStatusLabel(payment).padEnd(14).slice(0, 14)} PHP ${Number(payment.amount).toLocaleString("en-PH", { minimumFractionDigits: 2 })}`
    );
    const details = [
      payment.paid_at ? `Paid ${dateLabel(payment.paid_at)}` : "",
      payment.method || "",
      payment.reference_number ? `Ref ${payment.reference_number}` : "",
      Number(payment.refunded_amount || 0) > 0 ? `Refunded ${peso(Number(payment.refunded_amount))}` : "",
    ].filter(Boolean).join(" | ");
    if (details) lines.push(`  ${details}`);
  });

  const encoder = new TextEncoder();
  const pageLines = 49;
  const pages: string[][] = [];
  for (let i = 0; i < lines.length; i += pageLines) pages.push(lines.slice(i, i + pageLines));
  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>",
  ];

  pages.forEach((page, index) => {
    const pageObject = 4 + index * 2;
    const contentObject = pageObject + 1;
    const text = page.map((line, lineIndex) =>
      `BT /F1 9 Tf 40 ${752 - lineIndex * 14} Td (${pdfSafe(line)}) Tj ET`
    ).join("\n");
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObject} 0 R >>`,
      `<< /Length ${encoder.encode(text).length} >>\nstream\n${text}\nendstream`
    );
  });

  const chunks: string[] = [];
  const offsets = [0];
  let byteLength = 0;
  const append = (part: string) => {
    chunks.push(part);
    byteLength += encoder.encode(part).length;
  };

  append("%PDF-1.4\n");
  objects.forEach((object, index) => {
    offsets.push(byteLength);
    append(`${index + 1} 0 obj\n${object}\nendobj\n`);
  });
  const xrefOffset = byteLength;
  append(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`);
  offsets.slice(1).forEach(offset => append(`${String(offset).padStart(10, "0")} 00000 n \n`));
  append(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);

  const url = URL.createObjectURL(new Blob(chunks, { type: "application/pdf" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "tenant-payment-record.pdf";
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const TenantPayments = () => {
  const { toast } = useToast();
  const session = sessionStore.get();
  const userId = session?.user_id;
  const { data: history, error, refetch: refetchHistory } = useSupabasePolling<Payment[]>(
    listMyRentPayments,
    5000,
    Boolean(userId),
  );
  const { data: fullPayment, error: fullPaymentError, loading: fullPaymentLoading, refetch: refetchFullPayment } =
    useFinancialPolling<FullPaymentRequest | null>(getMyFullPaymentRequest, 5000, Boolean(userId));
  const { data: fullPaymentPreview, refetch: refetchFullPaymentPreview } =
    useFinancialPolling<FullPaymentPreview>(getMyFullPaymentPreview, 10000, Boolean(userId));
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Payment | null>(null);
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>("All");
  const [fullPaymentDialogOpen, setFullPaymentDialogOpen] = useState(false);
  const [fullPaymentBusy, setFullPaymentBusy] = useState(false);
  const [fullPaymentReference, setFullPaymentReference] = useState("");
  const [fullPaymentScreenshot, setFullPaymentScreenshot] = useState<File | null>(null);
  const [fullPaymentProofKey, setFullPaymentProofKey] = useState(() => newFinancialRequestId());
  const paymentSubmissionId = useRef<string | null>(null);
  const fullPaymentOpen = Boolean(fullPayment && ["Requested", "Approved", "Submitted"].includes(fullPayment.status));
  const coveredPaymentIds = new Set(fullPaymentOpen ? fullPayment?.installments.map(item => item.payment_id) : []);

  const startPay = (p: Payment) => {
    setSelected(p);
    paymentSubmissionId.current = newRentPaymentSubmissionId();
    setOpen(true);
  };

  const refreshFullPaymentData = () => {
    refetchHistory();
    refetchFullPayment();
    refetchFullPaymentPreview();
  };

  const submitFullPaymentRequest = async () => {
    setFullPaymentBusy(true);
    try {
      await requestMyFullPayment();
      toast({ title: "Full payment request submitted" });
      setFullPaymentDialogOpen(false);
      refreshFullPaymentData();
    } catch (error: unknown) {
      toast({
        title: error instanceof Error ? error.message : "Unable to submit full payment request.",
        variant: "destructive",
      });
    } finally {
      setFullPaymentBusy(false);
    }
  };

  const cancelFullPaymentRequest = async () => {
    if (!fullPayment) return;
    setFullPaymentBusy(true);
    try {
      await cancelMyFullPayment(fullPayment.request_id);
      toast({ title: "Full payment request cancelled" });
      refreshFullPaymentData();
    } catch (error: unknown) {
      toast({
        title: error instanceof Error ? error.message : "Unable to cancel full payment request.",
        variant: "destructive",
      });
    } finally {
      setFullPaymentBusy(false);
    }
  };

  const submitFullPaymentProof = async () => {
    if (!fullPayment || !fullPaymentReference.trim() || !fullPaymentScreenshot) {
      toast({ title: "Enter the GCash transaction number and upload a payment screenshot.", variant: "destructive" });
      return;
    }
    if (fullPaymentReference.trim().length > 120) {
      toast({ title: "GCash transaction number must be 120 characters or fewer.", variant: "destructive" });
      return;
    }
    setFullPaymentBusy(true);
    try {
      await submitMyFullPaymentProof(
        fullPayment.request_id,
        fullPaymentReference,
        fullPaymentScreenshot,
        fullPaymentProofKey,
      );
      toast({ title: "Payment proof submitted" });
      setFullPaymentReference("");
      setFullPaymentScreenshot(null);
      setFullPaymentProofKey(newFinancialRequestId());
      refreshFullPaymentData();
    } catch (error: unknown) {
      toast({
        title: error instanceof Error ? error.message : "Unable to submit payment proof.",
        variant: "destructive",
      });
    } finally {
      setFullPaymentBusy(false);
    }
  };

  const submit = async (method: string, reference: string, _captureId?: string, _orderId?: string, screenshot?: File) => {
    if (!selected) throw new Error("Select a rent payment before submitting.");
    if (method !== "GCash") throw new Error("Only GCash rent payments are supported.");
    paymentSubmissionId.current ??= newRentPaymentSubmissionId();
    await submitMyRentPayment({
      payment_id: selected.payment_id,
      reference,
      screenshot,
      submission_id: paymentSubmissionId.current,
    });
    paymentSubmissionId.current = null;
    toast({ title: "GCash payment submitted for admin review" });
    refetchHistory();
  };

  const variant = (s: string): "default" | "secondary" | "destructive" =>
    isPaid(s) ? "default" : s === "Pending" || s === "Submitted" ? "secondary" : "destructive";

  const records = history ?? [];
  const sortedRecords = [...records].sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""));
  const recordGroups = {
    Paid: sortedRecords.filter(payment => paymentCategory(payment) === "Paid"),
    Overdue: sortedRecords.filter(payment => paymentCategory(payment) === "Overdue"),
    Pending: sortedRecords.filter(payment => paymentCategory(payment) === "Pending"),
    Other: sortedRecords.filter(payment => paymentCategory(payment) === "Other"),
  };
  const visibleRecords = paymentFilter === "All"
    ? sortedRecords
    : recordGroups[paymentFilter];
  const periods = [...new Map(records
    .filter(p => p.check_in_date || p.check_out_date)
    .map(p => [`${p.check_in_date ?? ""}|${p.check_out_date ?? ""}`, {
      checkIn: p.check_in_date,
      checkOut: p.check_out_date,
    }])).values()];
  const totalPaid = records.filter(p => isPaid(p.status)).reduce((sum, p) => sum + Math.max(0, Number(p.amount) - Number(p.refunded_amount || 0)), 0);
  const totalDue = records
    .filter(p => p.status === "Pending" || p.status === "Overdue" || p.status === "Submitted")
    .reduce((sum, p) => sum + Number(p.amount), 0);
  const overdueCount = recordGroups.Overdue.length;
  const pendingCount = recordGroups.Pending.length;
  const paidCount = recordGroups.Paid.length;

  return (
    <DashboardLayout role="tenant">
      <div className="space-y-6">
        <div>
          <h1 className="font-display text-2xl font-bold">Payments</h1>
        </div>
        {!userId && <div className="p-3 rounded-md border border-warning/30 bg-warning/10 text-warning text-xs">Sign in to view payments.</div>}
        {error && <div className="p-3 rounded-md border border-destructive/30 bg-destructive/10 text-destructive text-xs">{error}</div>}
        {fullPaymentError && <div className="p-3 rounded-md border border-destructive/30 bg-destructive/10 text-destructive text-xs">{fullPaymentError}</div>}
        <RefundRequestHistory />

        {periods.length > 0 && (
          <div className="bg-primary/5 border border-primary/20 rounded-lg p-5">
            <h2 className="font-semibold mb-3">Full stay period</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {periods.map((period, index) => (
                <div key={`${period.checkIn ?? ""}-${period.checkOut ?? ""}-${index}`} className="rounded-md bg-card p-4">
                  <p className="text-xs text-muted-foreground">Check-in date</p>
                  <p className="font-semibold">{dateLabel(period.checkIn) || "Not recorded"}</p>
                  <p className="text-xs text-muted-foreground mt-3">Check-out date</p>
                  <p className="font-semibold">{dateLabel(period.checkOut) || "Not recorded"}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="bg-card border border-border rounded-lg p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-border">
            <div>
              <h2 className="font-display font-semibold text-lg">Payment record</h2>
              <p className="text-sm text-muted-foreground mt-1">Monthly rent from check-in through check-out</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="gap-2 shrink-0"
              disabled={!history?.length}
              onClick={() => {
                try {
                  downloadPaymentPdf(records, session?.full_name || session?.username || "Tenant");
                } catch (e) {
                  toast({
                    title: "Could not download payment record",
                    description: e instanceof Error ? e.message : "Please try again.",
                    variant: "destructive",
                  });
                }
              }}
            >
              <Download size={14} /> Download PDF
            </Button>
          </div>
          {!history && userId && <Loader2 size={14} className="animate-spin" />}
          {records.length > 0 && (
            <>
              <div className="grid gap-3 sm:grid-cols-3 py-4">
                <div className="rounded-lg border border-border p-3.5">
                  <p className="text-xs font-medium text-muted-foreground">Total paid</p>
                  <p className="font-display text-lg font-semibold mt-1">{peso(totalPaid)}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{paidCount} {paidCount === 1 ? "month" : "months"} paid</p>
                </div>
                <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3.5">
                  <p className="text-xs font-medium text-muted-foreground">Overdue</p>
                  <p className="font-display text-lg font-semibold mt-1">{overdueCount} {overdueCount === 1 ? "month" : "months"}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Past the due date</p>
                </div>
                <div className="rounded-lg border border-border p-3.5">
                  <p className="text-xs font-medium text-muted-foreground">Balance due</p>
                  <p className="font-display text-lg font-semibold mt-1">{peso(totalDue)}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{pendingCount} {pendingCount === 1 ? "month" : "months"} pending</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 pb-3">
                <p className="text-xs font-medium text-muted-foreground">Filter by payment status</p>
                <p className="text-xs text-muted-foreground">{visibleRecords.length} of {records.length} records</p>
              </div>
            </>
          )}
          {history?.length === 0 && <p className="text-sm text-muted-foreground">No payment records yet.</p>}
          <div className="flex flex-wrap gap-2 mb-4" role="group" aria-label="Filter payment records by status">
            {(["All", "Paid", "Overdue", "Pending", "Other"] as const).map(filter => {
              const count = filter === "All" ? records.length : recordGroups[filter].length;
              return (
                <Button
                  key={filter}
                  type="button"
                  size="sm"
                  variant={paymentFilter === filter ? "default" : "outline"}
                  aria-pressed={paymentFilter === filter}
                  className="rounded-full"
                  onClick={() => setPaymentFilter(filter)}
                >
                  {filter}<span className="ml-1 opacity-75">{count}</span>
                </Button>
              );
            })}
          </div>
          <div className="overflow-hidden rounded-lg border border-border">
            <div className="hidden sm:grid sm:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_auto] gap-4 bg-muted/40 px-4 py-2.5 text-xs font-medium text-muted-foreground">
              <span>Billing month</span>
              <span>Due date</span>
              <span>Payment details</span>
              <span className="text-right">Amount / status</span>
            </div>
            {visibleRecords.map(p => (
              <div key={p.payment_id} className="grid gap-3 border-t border-border px-4 py-3.5 sm:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-center sm:gap-4">
                <div className="min-w-0">
                  <p className="font-medium text-sm">{monthLabel(p.due_date)}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{p.description || "Monthly rent"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground sm:hidden">Due date</p>
                  <p className="text-sm">{dateLabel(p.due_date) || "Not available"}</p>
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground sm:hidden">Payment details</p>
                  <p className="text-sm">{p.paid_at ? `Paid ${dateLabel(p.paid_at)}` : isPaid(p.status) ? "Paid" : "Not paid yet"}</p>
                  {(p.method || p.reference_number || p.has_payment_screenshot) && (
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">
                      {[p.method, p.reference_number ? `Transaction #${p.reference_number}` : "", p.has_payment_screenshot ? "GCash screenshot submitted" : ""].filter(Boolean).join(" · ")}
                    </p>
                  )}
                  {Number(p.refunded_amount || 0) > 0 && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Refunded {peso(Number(p.refunded_amount))} · Remaining paid {peso(Math.max(0, Number(p.amount) - Number(p.refunded_amount)))}
                    </p>
                  )}
                </div>
                <div className="flex items-center justify-between gap-3 sm:flex-col sm:items-end sm:gap-1">
                  <p className="font-semibold text-sm">{peso(Number(p.amount))}</p>
                  <div className="flex items-center gap-2">
                    <Badge variant={isRefunded(p) ? "secondary" : variant(paymentStatusLabel(p))} className="text-xs">
                      {isPaid(p.status) && !isRefunded(p) && <CheckCircle2 size={10} className="mr-1" />}
                      {paymentStatusLabel(p)}
                    </Badge>
                      {isPaid(p.status) && Boolean(p.refund_available) && !isRefunded(p) && (
                        <RefundRequestButton
                          paymentId={p.payment_id}
                          onSubmitted={refetchHistory}
                        />
                      )}
                      {(p.status === "Pending" || p.status === "Overdue") && (
                      <Button size="sm" className="h-7 gap-1 px-2" onClick={() => startPay(p)} disabled={coveredPaymentIds.has(p.payment_id)}>
                        <CreditCard size={12} /> {coveredPaymentIds.has(p.payment_id) ? "In full request" : "Pay"}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {history && visibleRecords.length === 0 && (
              <p className="text-sm text-muted-foreground px-4 py-8 text-center">No {paymentFilter.toLowerCase()} payment months.</p>
            )}
          </div>
        </div>

        {Boolean(fullPaymentPreview?.eligible && !fullPaymentLoading && !fullPaymentOpen) && (
          <div className="flex justify-end">
            <Button className="gap-2" onClick={() => setFullPaymentDialogOpen(true)}>
              <Wallet size={15} /> Request full payment
            </Button>
          </div>
        )}

        {fullPayment && (
          <section className="bg-card border border-border rounded-lg p-5 space-y-4">
            <header className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-display font-semibold text-lg">Full Payment Request</h2>
                <p className="text-sm text-muted-foreground mt-1">Request #{fullPayment.request_id} · {peso(Number(fullPayment.total_amount))}</p>
              </div>
              <Badge variant={fullPayment.status === "Confirmed" ? "default" : fullPayment.status === "Rejected" ? "destructive" : "secondary"}>
                {fullPayment.status}
              </Badge>
            </header>
            {fullPayment.status === "Requested" && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-muted/40 p-3 text-sm">
                <p className="text-muted-foreground">Waiting for admin approval. Covered installments cannot be paid individually.</p>
                <Button variant="outline" size="sm" onClick={() => void cancelFullPaymentRequest()} disabled={fullPaymentBusy}>
                  {fullPaymentBusy && <Loader2 size={14} className="mr-2 animate-spin" />}<XCircle size={14} className="mr-1" />Cancel request
                </Button>
              </div>
            )}
            {fullPayment.status === "Approved" && (
              <div className="space-y-4">
                <div className="rounded-md border border-primary/20 bg-primary/5 p-3">
                  <p className="text-xs text-muted-foreground">Fixed amount to pay</p>
                  <p className="font-display text-xl font-bold text-primary">{peso(Number(fullPayment.total_amount))}</p>
                </div>
                {fullPayment.qr_url && (
                  <div className="rounded-lg border border-border bg-white p-3">
                    <p className="mb-2 text-center text-sm text-gray-700">Pay this fixed amount using the GCash QR.</p>
                    <img src={fullPayment.qr_url} alt="Fixed-amount GCash QR" className="mx-auto max-h-[420px] max-w-full object-contain" />
                  </div>
                )}
                {fullPayment.admin_note && <p className="text-sm text-muted-foreground">Admin note: {fullPayment.admin_note}</p>}
                <div className="grid gap-3 rounded-md border border-border p-4">
                  <p className="text-sm font-medium">Submit your GCash payment proof</p>
                  <div className="grid gap-1.5">
                    <Label htmlFor="full-payment-reference">GCash transaction number *</Label>
                    <Input id="full-payment-reference" value={fullPaymentReference} maxLength={120} autoComplete="off" onChange={event => {
                      setFullPaymentReference(event.target.value);
                      setFullPaymentProofKey(newFinancialRequestId());
                    }} placeholder="Enter the reference from your GCash receipt" />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="full-payment-screenshot">GCash payment screenshot *</Label>
                    <Input id="full-payment-screenshot" type="file" accept="image/jpeg,image/png,image/webp" onChange={event => {
                      setFullPaymentScreenshot(event.target.files?.[0] ?? null);
                      setFullPaymentProofKey(newFinancialRequestId());
                    }} />
                    <p className="text-xs text-muted-foreground">JPG, PNG, or WEBP; maximum 5MB. Both the transaction number and screenshot are required.</p>
                  </div>
                  <Button className="w-fit" onClick={() => void submitFullPaymentProof()} disabled={fullPaymentBusy || !fullPaymentReference.trim() || !fullPaymentScreenshot}>
                    {fullPaymentBusy && <Loader2 size={14} className="mr-2 animate-spin" />}Submit payment proof
                  </Button>
                </div>
              </div>
            )}
            {fullPayment.status === "Submitted" && (
              <div className="rounded-md bg-muted/40 p-3 text-sm text-muted-foreground">
                Payment proof submitted{fullPayment.reference_number ? ` (transaction #${fullPayment.reference_number})` : ""}. Waiting for admin verification.
              </div>
            )}
            {fullPayment.status === "Confirmed" && (
              <p className="rounded-md bg-success/10 p-3 text-sm text-success">Payment confirmed. All covered installments have been recorded as paid.</p>
            )}
            {fullPayment.status === "Rejected" && (
              <div className="rounded-md border border-destructive/20 bg-destructive/5 p-3 text-sm">
                <p className="font-medium">Request rejected</p>
                {fullPayment.admin_note && <p className="mt-1 text-muted-foreground">Admin note: {fullPayment.admin_note}</p>}
              </div>
            )}
            <div className="space-y-2 border-t border-border pt-3">
              <p className="text-sm font-medium">Covered installments</p>
              {fullPayment.installments.map(item => (
                <div key={item.payment_id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span>{item.description || `Payment #${item.payment_id}`}{item.due_date ? ` · ${dateLabel(item.due_date)}` : ""}</span>
                  <span className="flex items-center gap-2">{peso(Number(item.amount))}<Badge variant={isPaid(item.status) ? "default" : "secondary"}>{isPaid(item.status) ? "Paid" : item.status}</Badge></span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      <Dialog open={fullPaymentDialogOpen} onOpenChange={setFullPaymentDialogOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Request full payment</DialogTitle>
            <DialogDescription>Ask the admin to prepare one fixed-amount GCash payment for your remaining rent installments.</DialogDescription>
          </DialogHeader>
          {fullPaymentPreview ? (
            <div className="space-y-3">
              <div className="rounded-md border border-primary/20 bg-primary/5 p-3">
                <p className="text-xs text-muted-foreground">Server-calculated total</p>
                <p className="font-display text-xl font-bold text-primary">{peso(Number(fullPaymentPreview.total_amount))}</p>
              </div>
              <div className="space-y-2">
                <p className="text-sm font-medium">Installments covered ({fullPaymentPreview.installments.length})</p>
                {fullPaymentPreview.installments.map(item => (
                  <div key={item.payment_id} className="flex items-center justify-between gap-3 rounded-md bg-muted/40 p-2.5 text-sm">
                    <span>{item.description || `Payment #${item.payment_id}`}{item.due_date ? ` · ${dateLabel(item.due_date)}` : ""}</span>
                    <span className="font-medium">{peso(Number(item.amount))}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 size={14} className="animate-spin" /> Calculating remaining rent…</div>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setFullPaymentDialogOpen(false)} disabled={fullPaymentBusy}>Cancel</Button>
            <Button onClick={() => void submitFullPaymentRequest()} disabled={fullPaymentBusy || !fullPaymentPreview?.eligible}>
              {fullPaymentBusy && <Loader2 size={14} className="mr-2 animate-spin" />}Confirm request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BookingPaymentDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            setSelected(null);
            paymentSubmissionId.current = null;
          }
        }}
        roomName={selected ? `Payment #${selected.payment_id}` : undefined}
        amount={selected ? peso(selected.amount) : undefined}
        amountPHP={selected ? Number(selected.amount) : 0}
        paymentId={selected ? selected.payment_id : undefined}
        allowedMethods={["gcash"]}
        title="Pay Rent with GCash"
        description={`Submit your rent payment for ${selected ? `payment #${selected.payment_id}` : "this balance"}.`}
        successTitle="GCash Payment Submitted"
        successDescription="Your GCash payment evidence has been submitted and will remain pending until an admin reviews it."
        allowScreenshot
        onPaid={submit}
      />
    </DashboardLayout>
  );
};

export default TenantPayments;
