import { DashboardLayout } from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertTriangle, CheckCircle2, XCircle, Clock, Loader2,
  ReceiptText, ArrowLeftRight, CalendarDays, Banknote,
} from "lucide-react";
import { useEffect, useState, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import { usePolling } from "@/hooks/usePolling";
import { api, endpoints, sessionStore, type ApiResponse } from "@/lib/api";

/* ── types ─────────────────────────────────────────────── */
interface Preview {
  full_name: string;
  room_number: string;
  monthly_rent: number;
  daily_rate: number;
  move_in_date: string;
  cancellation_date: string;
  calculated_at: string;
  days_consumed: number;
  amount_used: number;
  refund_amount: number;
}

interface CancellationStatus {
  cancellation_id: number;
  status: "Pending" | "Approved" | "Rejected" | "Withdrawn" | "Expired";
  cancellation_expires_at: string;
  cancellation_date: string;
  days_consumed: number;
  refund_amount: number;
  daily_rate: number;
  amount_used: number;
  monthly_rent: number;
  move_in_date: string;
  room_number: string;
  rejection_reason: string | null;
}

const peso = (n: number) =>
  "₱" + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* ── countdown hook ────────────────────────────────────── */
function useCountdown(expiresAt: string | null) {
  const [remaining, setRemaining] = useState<number>(0);
  const ref = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!expiresAt) return;
    const tick = () => {
      const diff = new Date(expiresAt).getTime() - Date.now();
      setRemaining(Math.max(0, diff));
    };
    tick();
    ref.current = setInterval(tick, 1000);
    return () => { if (ref.current) clearInterval(ref.current); };
  }, [expiresAt]);

  const mins = Math.floor(remaining / 60000);
  const secs = Math.floor((remaining % 60000) / 1000);
  return { remaining, label: `${mins}:${secs.toString().padStart(2, "0")}` };
}

/* ── component ─────────────────────────────────────────── */
const TenantCancellation = () => {
  const { toast } = useToast();
  const session = sessionStore.get();
  const userId = session?.user_id;

  // Poll tenant's active cancellation
  const { data: status, refetch, loading: statusLoading } = usePolling<CancellationStatus | null>(
    userId ? `${endpoints.tenantCancellations}?action=my_status&user_id=${userId}` : null,
    { intervalMs: 5000 }
  );

  const { remaining, label: countdownLabel } = useCountdown(
    status?.status === "Pending" ? status.cancellation_expires_at : null
  );

  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // Once we know there's no pending/active request, show the calculator
  const showCalculator = !statusLoading && (status === null || status?.status === "Withdrawn" || status?.status === "Expired");

  useEffect(() => {
    if (showCalculator && userId && !preview) loadPreview();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showCalculator, userId]);

  const loadPreview = async () => {
    if (!userId) return;
    setPreviewLoading(true);
    try {
      const res = await api.get<ApiResponse<Preview>>(
        `${endpoints.tenantCancellations}?action=preview&user_id=${userId}`
      );
      if (res.data.type === "success" && res.data.data) setPreview(res.data.data);
    } finally {
      setPreviewLoading(false);
    }
  };

  const submitRequest = async () => {
    if (!userId) return;
    setBusy(true);
    try {
      const res = await api.post<ApiResponse>(
        `${endpoints.tenantCancellations}?action=request`,
        { user_id: userId }
      );
      if (res.data.type === "success") {
        toast({ title: "Cancellation request submitted" });
        setConfirmOpen(false);
        refetch();
      } else {
        toast({ title: res.data.message || "Failed", variant: "destructive" });
      }
    } finally { setBusy(false); }
  };

  const withdraw = async () => {
    if (!userId || !status) return;
    setBusy(true);
    try {
      const res = await api.post<ApiResponse>(
        `${endpoints.tenantCancellations}?action=withdraw`,
        { user_id: userId, cancellation_id: status.cancellation_id }
      );
      if (res.data.type === "success") {
        toast({ title: "Request withdrawn" });
        setWithdrawOpen(false);
        refetch();
      } else {
        toast({ title: res.data.message || "Failed", variant: "destructive" });
      }
    } finally { setBusy(false); }
  };

  /* ── render ──────────────────────────────────────────── */
  return (
    <DashboardLayout role="tenant">
      <div className="space-y-6 max-w-2xl">
        <div>
          <h1 className="font-display text-2xl font-bold">Cancellation Request</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Request to cancel your tenancy and receive your refund.
          </p>
        </div>

        {!userId && (
          <div className="p-3 rounded-md border border-warning/30 bg-warning/10 text-warning text-xs">
            Sign in to manage your cancellation.
          </div>
        )}

        {/* ── OUTCOME: Approved ── */}
        {status?.status === "Approved" && (
          <div className="bg-card border border-border rounded-xl p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-full bg-green-500/15 flex items-center justify-center">
                <CheckCircle2 size={24} className="text-green-500" />
              </div>
              <div>
                <p className="font-display font-bold text-lg">Cancellation Approved</p>
                <p className="text-sm text-muted-foreground">Your tenancy has been cancelled.</p>
              </div>
            </div>
            <RefundBreakdown r={status} />
            <p className="text-sm text-muted-foreground">
              A refund of <span className="font-semibold text-foreground">{peso(status.refund_amount)}</span> has been
              recorded in your payment history.
            </p>
          </div>
        )}

        {/* ── OUTCOME: Rejected ── */}
        {status?.status === "Rejected" && (
          <div className="bg-card border border-destructive/40 rounded-xl p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center">
                <XCircle size={24} className="text-destructive" />
              </div>
              <div>
                <p className="font-display font-bold text-lg">Cancellation Rejected</p>
                {status.rejection_reason && (
                  <p className="text-sm text-muted-foreground mt-0.5">{status.rejection_reason}</p>
                )}
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              Please contact management if you have questions.
            </p>
          </div>
        )}

        {/* ── OUTCOME: Expired ── */}
        {status?.status === "Expired" && (
          <div className="bg-card border border-warning/40 rounded-xl p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-full bg-warning/10 flex items-center justify-center">
                <Clock size={24} className="text-warning" />
              </div>
              <div>
                <p className="font-display font-bold text-lg">Cancellation Request Expired</p>
                <p className="text-sm text-muted-foreground mt-0.5">The review window closed before the request was acted on.</p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              You can submit a new request if you still want to cancel your tenancy.
            </p>
          </div>
        )}

        {/* ── ACTIVE: Pending countdown ── */}
        {status?.status === "Pending" && (
          <div className="bg-card border border-border rounded-xl p-6 space-y-5">
            <div className="flex items-start justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <div className="h-12 w-12 rounded-full bg-orange-500/15 flex items-center justify-center">
                  <Clock size={24} className="text-orange-500" />
                </div>
                <div>
                  <p className="font-display font-bold text-lg">Pending Admin Review</p>
                  <p className="text-sm text-muted-foreground">You can withdraw before the window closes.</p>
                </div>
              </div>
              <Badge variant="secondary" className="text-base font-mono px-3 py-1">
                {remaining > 0 ? countdownLabel : "Window closed"}
              </Badge>
            </div>

            <RefundBreakdown r={status} />

            {remaining > 0 && (
              <Button
                variant="outline"
                className="border-destructive text-destructive hover:bg-destructive/10"
                onClick={() => setWithdrawOpen(true)}
              >
                <XCircle size={16} className="mr-2" /> Withdraw Request
              </Button>
            )}
          </div>
        )}

        {/* ── CALCULATOR: No active request ── */}
        {(showCalculator) && (
          <>
            {previewLoading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 size={14} className="animate-spin" /> Loading refund preview…
              </div>
            )}

            {preview && (
              <div className="bg-card border border-border rounded-xl p-6 space-y-5">
                <div className="flex items-center gap-2">
                  <ReceiptText size={20} className="text-primary" />
                  <h2 className="font-display font-semibold text-lg">Refund Calculator</h2>
                </div>

                <div className="grid sm:grid-cols-2 gap-3">
                  <InfoRow icon={<CalendarDays size={14} />} label="Check-in date" value={preview.move_in_date} />
                  <InfoRow icon={<CalendarDays size={14} />} label="Cancellation date" value={preview.cancellation_date} />
                  <InfoRow icon={<ArrowLeftRight size={14} />} label="Days consumed" value={`${preview.days_consumed} days`} />
                  <InfoRow icon={<Banknote size={14} />} label="Daily rate" value={peso(preview.daily_rate)} />
                  <div className="sm:col-span-2">
                    <InfoRow
                      icon={<Clock size={14} />}
                      label="Calculated at"
                      value={new Date(preview.calculated_at).toLocaleString()}
                    />
                  </div>
                </div>

                <div className="border border-border rounded-lg overflow-hidden">
                  <div className="flex justify-between p-3 bg-muted/40 text-sm">
                    <span className="text-muted-foreground">Monthly rent</span>
                    <span className="font-medium">{peso(preview.monthly_rent)}</span>
                  </div>
                  <div className="flex justify-between p-3 text-sm border-t border-border">
                    <span className="text-muted-foreground">Amount used ({preview.days_consumed} × {peso(preview.daily_rate)})</span>
                    <span className="font-medium text-destructive">− {peso(preview.amount_used)}</span>
                  </div>
                  <div className="flex justify-between p-3 text-sm border-t border-border bg-primary/5">
                    <span className="font-semibold">Estimated refund</span>
                    <span className="font-bold text-primary text-base">{peso(preview.refund_amount)}</span>
                  </div>
                </div>

                {preview.days_consumed >= 30 && (
                  <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/30 text-destructive text-xs">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                    30 or more days have passed since check-in. No refund is applicable.
                  </div>
                )}

                <div className="flex items-start gap-2 p-3 rounded-md bg-muted/50 text-xs text-muted-foreground">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0 text-orange-500" />
                  Cancellation requests expire in <strong className="text-foreground">45 minutes</strong> if not
                  acted on by management. This action cannot be undone once approved.
                </div>

                <Button
                  className="w-full"
                  variant="destructive"
                  onClick={() => setConfirmOpen(true)}
                >
                  Request Cancellation
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Confirm dialog ── */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Confirm Cancellation Request</DialogTitle>
            <DialogDescription>
              This will notify management and start a 45-minute review window. You can withdraw before
              it expires.
            </DialogDescription>
          </DialogHeader>
          {preview && (
            <div className="border border-border rounded-lg overflow-hidden text-sm">
              <div className="flex justify-between p-3 bg-muted/40">
                <span className="text-muted-foreground">Estimated refund</span>
                <span className="font-bold text-primary">{peso(preview.refund_amount)}</span>
              </div>
              <div className="flex justify-between p-3 border-t border-border">
                <span className="text-muted-foreground">Days consumed</span>
                <span>{preview.days_consumed}</span>
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="secondary" onClick={() => setConfirmOpen(false)}>Go Back</Button>
            <Button variant="destructive" onClick={submitRequest} disabled={busy}>
              {busy ? <><Loader2 size={14} className="mr-2 animate-spin" /> Submitting…</> : "Yes, Request Cancellation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Withdraw dialog ── */}
      <Dialog open={withdrawOpen} onOpenChange={setWithdrawOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Withdraw Request</DialogTitle>
            <DialogDescription>
              Are you sure you want to withdraw your cancellation request? Your tenancy will remain active.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="secondary" onClick={() => setWithdrawOpen(false)}>No, Keep It</Button>
            <Button onClick={withdraw} disabled={busy}>
              {busy ? <Loader2 size={14} className="mr-2 animate-spin" /> : null}
              Yes, Withdraw
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
};

/* ── sub-components ─────────────────────────────────────── */
function RefundBreakdown({ r }: { r: Pick<CancellationStatus, "monthly_rent" | "daily_rate" | "days_consumed" | "amount_used" | "refund_amount"> }) {
  return (
    <div className="border border-border rounded-lg overflow-hidden text-sm">
      <div className="flex justify-between p-3 bg-muted/40">
        <span className="text-muted-foreground">Monthly rent</span>
        <span>{peso(r.monthly_rent)}</span>
      </div>
      <div className="flex justify-between p-3 border-t border-border">
        <span className="text-muted-foreground">Amount used ({r.days_consumed} days × {peso(r.daily_rate)})</span>
        <span className="text-destructive">− {peso(r.amount_used)}</span>
      </div>
      <div className="flex justify-between p-3 border-t border-border bg-primary/5 font-semibold">
        <span>Refund amount</span>
        <span className="text-primary">{peso(r.refund_amount)}</span>
      </div>
    </div>
  );
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 p-3 rounded-md bg-muted/40">
      <span className="text-muted-foreground">{icon}</span>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="font-medium text-sm">{value}</p>
      </div>
    </div>
  );
}

export default TenantCancellation;
