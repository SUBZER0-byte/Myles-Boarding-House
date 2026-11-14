import { useCallback, useEffect, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ImagePreview } from "@/components/ImagePreview";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle2, Loader2, Search, XCircle } from "lucide-react";
import { useFinancialPolling } from "@/hooks/useFinancialPolling";
import { useToast } from "@/hooks/use-toast";
import {
  decideAdminFullPayment,
  listAdminFullPaymentRequests,
  newFinancialRequestId,
  approveAdminFullPayment,
  type AdminFullPaymentRequest,
} from "@/lib/financialWorkflows";

const peso = (amount: number) => `₱${Number(amount).toLocaleString("en-PH", { minimumFractionDigits: 2 })}`;
const statuses = ["All", "Requested", "Approved", "Submitted", "Confirmed", "Rejected", "Cancelled"] as const;
type StatusFilter = typeof statuses[number];

const AdminFullPayments = () => {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("All");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<AdminFullPaymentRequest | null>(null);
  const [note, setNote] = useState("");
  const [qrImage, setQrImage] = useState<File | null>(null);
  const [qrPreviewUrl, setQrPreviewUrl] = useState<string | null>(null);
  const [qrUploadKey, setQrUploadKey] = useState(() => newFinancialRequestId());
  const [busy, setBusy] = useState(false);
  const loadRequests = useCallback(
    () => listAdminFullPaymentRequests(statusFilter, search),
    [statusFilter, search],
  );
  const { data: requests, error, refetch } = useFinancialPolling<AdminFullPaymentRequest[]>(loadRequests);
  const request = requests?.find(item => item.request_id === selected?.request_id) ?? selected;
  useEffect(() => {
    if (!qrImage) {
      setQrPreviewUrl(null);
      return;
    }
    const previewUrl = URL.createObjectURL(qrImage);
    setQrPreviewUrl(previewUrl);
    return () => URL.revokeObjectURL(previewUrl);
  }, [qrImage]);

  const submitDecision = async (action: "reject" | "confirm" | "reject_proof") => {
    if (!request) return;
    setBusy(true);
    try {
      const actionName = action === "reject"
        ? "admin_full_reject"
        : action === "confirm" ? "admin_full_confirm" : "admin_full_reject_proof";
      await decideAdminFullPayment(request.request_id, actionName, note);
      toast({ title: "Full payment request updated" });
      setNote("");
      await refetch();
    } catch (error) {
      toast({
        title: error instanceof Error ? error.message : "Unable to update full payment request.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const approve = async () => {
    if (!request || !qrImage) {
      toast({ title: "Upload the fixed-amount GCash QR image.", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      await approveAdminFullPayment(request.request_id, note, qrImage, qrUploadKey);
      toast({ title: "Full payment request approved" });
      setNote("");
      setQrImage(null);
      setQrUploadKey(newFinancialRequestId());
      await refetch();
    } catch (error) {
      toast({
        title: error instanceof Error ? error.message : "Unable to approve full payment request.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const closeDetails = (open: boolean) => {
    if (!open) {
      setSelected(null);
      setNote("");
      setQrImage(null);
      setQrUploadKey(newFinancialRequestId());
    }
  };

  const badgeVariant = (status: AdminFullPaymentRequest["status"]) =>
    status === "Confirmed" ? "default" : status === "Rejected" ? "destructive" : "secondary";

  return (
    <DashboardLayout role="admin">
      <div className="space-y-6">
        <div>
          <h1 className="font-display text-2xl font-bold">Full Payment Requests</h1>
          <p className="text-muted-foreground text-sm mt-1">Review each tenant request, send the fixed-amount QR, then verify their GCash payment proof.</p>
        </div>
        {error && <div className="p-3 rounded-md border border-destructive/30 bg-destructive/10 text-destructive text-xs">{error}</div>}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter full payment requests">
            {statuses.map(status => (
              <Button key={status} size="sm" variant={statusFilter === status ? "default" : "outline"} onClick={() => setStatusFilter(status)}>
                {status === "Requested" ? "Needs approval"
                  : status === "Submitted" ? "Needs verification"
                    : status}
              </Button>
            ))}
          </div>
          <div className="relative w-full sm:max-w-xs">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search tenant or room" />
          </div>
        </div>
        {!requests && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 size={14} className="animate-spin" /> Loading full payment requests…</div>}
        {requests?.length === 0 && <div className="bg-card border border-border rounded-lg p-8 text-center text-sm text-muted-foreground">No full payment requests found.</div>}
        {Boolean(requests?.length) && (
          <div className="overflow-x-auto bg-card border border-border rounded-lg">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Tenant / room</th>
                  <th className="px-4 py-3 font-medium">Installments</th>
                  <th className="px-4 py-3 font-medium">Fixed total</th>
                  <th className="px-4 py-3 font-medium">Payment proof</th>
                  <th className="px-4 py-3 font-medium">Submitted</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium text-right">Next action</th>
                </tr>
              </thead>
              <tbody>
                {requests?.map(item => (
                  <tr key={item.request_id} className="border-t border-border">
                    <td className="px-4 py-3">
                      <p className="font-medium">{item.full_name || `Tenant #${item.tenant_id}`}</p>
                      <p className="text-xs text-muted-foreground">{item.room_number ? `Room ${item.room_number}` : "Room unavailable"}{item.email ? ` · ${item.email}` : ""}</p>
                    </td>
                    <td className="px-4 py-3">{item.installment_count}</td>
                    <td className="px-4 py-3 font-semibold">{peso(Number(item.total_amount))}</td>
                    <td className="px-4 py-3 text-xs">
                      {item.status === "Submitted"
                        ? <span className="font-medium text-primary">{item.reference_number ? `Ref ${item.reference_number}` : "Proof uploaded"}</span>
                        : item.has_screenshot ? "Proof on file" : "Not submitted"}
                    </td>
                    <td className="px-4 py-3 text-xs">{new Date(item.created_at).toLocaleDateString()}</td>
                    <td className="px-4 py-3"><Badge variant={badgeVariant(item.status)}>{item.status}</Badge></td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        size="sm"
                        variant={item.status === "Submitted" ? "default" : "outline"}
                        onClick={() => { setSelected(item); setNote(""); setQrImage(null); }}
                      >
                        {item.status === "Requested" ? "Review & approve" : item.status === "Submitted" ? "Verify payment" : "View details"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Dialog open={Boolean(selected)} onOpenChange={closeDetails}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          {request && (
            <>
              <DialogHeader>
                <DialogTitle>Full payment request #{request.request_id}</DialogTitle>
                <DialogDescription>
                  {request.status === "Requested" ? "Step 1 of 2 · Review the request and approve it with a fixed-amount GCash QR."
                    : request.status === "Submitted" ? "Step 2 of 2 · Check the tenant’s transaction number and screenshot before confirming."
                      : "Review request details and payment status."}
                </DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-2 text-center text-xs">
                <div className={`rounded-md border p-2 ${request.status === "Requested" ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground"}`}>
                  <span className="font-semibold">1. Approve & send QR</span>
                </div>
                <div className={`rounded-md border p-2 ${request.status === "Submitted" ? "border-primary bg-primary/5 text-primary" : request.status === "Confirmed" ? "border-success/30 bg-success/5 text-success" : "border-border text-muted-foreground"}`}>
                  <span className="font-semibold">2. Verify payment</span>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-muted/40 p-3">
                <div>
                  <p className="font-medium">{request.full_name || `Tenant #${request.tenant_id}`}</p>
                  <p className="text-xs text-muted-foreground">{request.email || "—"} · {request.room_number ? `Room ${request.room_number}` : "Room unavailable"}</p>
                </div>
                <Badge variant={badgeVariant(request.status)}>{request.status}</Badge>
              </div>
              <div className="rounded-md border border-primary/20 bg-primary/5 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-xs text-muted-foreground">{request.status === "Submitted" || request.status === "Confirmed" ? "Amount to verify" : "Fixed full payment amount"}</p>
                    <p className="font-display text-2xl font-bold text-primary">{peso(Number(request.total_amount))}</p>
                  </div>
                  <p className="text-xs text-muted-foreground">{request.installment_count} rent installments</p>
                </div>
              </div>
              <div className="overflow-hidden rounded-md border border-border">
                <div className="grid grid-cols-[1fr_auto_auto] gap-3 bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
                  <span>Installment</span><span>Due date</span><span>Amount / status</span>
                </div>
                {request.installments.map(item => (
                  <div key={item.payment_id} className="grid grid-cols-[1fr_auto_auto] gap-3 border-t border-border px-3 py-2.5 text-sm">
                    <div><p className="font-medium">{item.description || `Payment #${item.payment_id}`}</p><p className="text-xs text-muted-foreground">Payment #{item.payment_id}</p></div>
                    <span className="text-xs">{item.due_date || "—"}</span>
                    <div className="text-right"><p className="font-medium">{peso(Number(item.amount))}</p><Badge variant={item.payment_status === "Paid" ? "default" : "secondary"}>{item.payment_status}</Badge></div>
                  </div>
                ))}
              </div>
              {["Submitted", "Confirmed"].includes(request.status) && (
                <div className="space-y-3 rounded-md border border-primary/20 bg-primary/5 p-4 text-sm">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Tenant’s GCash transaction number</p>
                    <p className="mt-1 break-all font-mono text-lg font-semibold">{request.reference_number || "Not provided"}</p>
                  </div>
                  {request.has_screenshot && (
                    <>
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Payment screenshot</p>
                      {request.screenshot_url && (
                        <ImagePreview
                          src={request.screenshot_url}
                          alt={`GCash payment proof for full payment request ${request.request_id}`}
                          triggerClassName="block w-full overflow-hidden rounded-md border border-border bg-white"
                          imageClassName="max-h-72 w-full object-contain"
                        />
                      )}
                    </>
                  )}
                  <p className="text-xs text-muted-foreground">Compare the transaction evidence with the fixed amount above before confirming.</p>
                </div>
              )}
              {request.admin_note && <p className="text-sm"><span className="text-muted-foreground">Admin note:</span> {request.admin_note}</p>}

              {request.status === "Requested" && (
                <div className="space-y-3 border-t border-border pt-4">
                  <div className="grid gap-1.5">
                    <Label htmlFor="full-payment-qr">Fixed-amount GCash QR image</Label>
                    <Input id="full-payment-qr" type="file" accept="image/jpeg,image/png,image/webp" onChange={event => {
                      setQrImage(event.target.files?.[0] ?? null);
                      setQrUploadKey(newFinancialRequestId());
                    }} />
                    <p className="text-xs text-muted-foreground">JPG, PNG, or WEBP; maximum 5MB.</p>
                  </div>
                  {qrPreviewUrl && (
                    <div className="rounded-md border border-border bg-white p-3">
                      <p className="mb-2 text-xs font-medium text-muted-foreground">QR preview · Tenant will pay {peso(Number(request.total_amount))}</p>
                      <ImagePreview
                        src={qrPreviewUrl}
                        alt="Preview of the GCash QR to send to the tenant"
                        triggerClassName="mx-auto"
                        imageClassName="max-h-56 object-contain"
                      />
                    </div>
                  )}
                  <Textarea maxLength={2000} rows={2} placeholder="Optional note to the tenant" value={note} onChange={event => setNote(event.target.value)} />
                  <DialogFooter className="gap-2">
                    <Button variant="destructive" onClick={() => void submitDecision("reject")} disabled={busy || !note.trim()}>
                      {busy ? <Loader2 size={14} className="mr-2 animate-spin" /> : <XCircle size={14} className="mr-2" />}Reject request
                    </Button>
                    <Button onClick={() => void approve()} disabled={busy || !qrImage}>
                      {busy ? <Loader2 size={14} className="mr-2 animate-spin" /> : <CheckCircle2 size={14} className="mr-2" />}Approve · send QR for {peso(Number(request.total_amount))}
                    </Button>
                  </DialogFooter>
                </div>
              )}
              {request.status === "Submitted" && (
                <div className="space-y-3 border-t border-border pt-4">
                  <Textarea maxLength={2000} rows={2} placeholder="Required note if rejecting proof" value={note} onChange={event => setNote(event.target.value)} />
                  <DialogFooter className="gap-2">
                    <Button variant="destructive" onClick={() => void submitDecision("reject_proof")} disabled={busy || !note.trim()}>
                      {busy ? <Loader2 size={14} className="mr-2 animate-spin" /> : <XCircle size={14} className="mr-2" />}Reject proof
                    </Button>
                    <Button onClick={() => void submitDecision("confirm")} disabled={busy || !request.has_screenshot || !request.reference_number}>
                      {busy ? <Loader2 size={14} className="mr-2 animate-spin" /> : <CheckCircle2 size={14} className="mr-2" />}Confirm payment
                    </Button>
                  </DialogFooter>
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
};

export default AdminFullPayments;
