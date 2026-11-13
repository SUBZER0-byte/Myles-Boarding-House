import { DashboardLayout } from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  CheckCircle2, XCircle, Loader2, CalendarDays,
  BedDouble, User, Banknote, ArrowLeftRight, Clock, AlertTriangle,
} from "lucide-react";
import { useCallback, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { useSupabasePolling } from "@/hooks/useSupabasePolling";
import { listAdminCancelledGuestBookings } from "@/lib/guestBookings";
import {
  approveTenantCancellation,
  getAdminCancellations,
  rejectTenantCancellation,
  type AdminCancellationRequest,
} from "@/lib/tenantCancellations";

/* ── types ─────────────────────────────────────────────── */
interface CancelledBooking {
  booking_id: number;
  full_name: string;
  email: string;
  phone: string | null;
  room_id: number | null;
  room_number: string | null;
  monthly_rent: number | null;
  move_in_date: string | null;
  status: string;
  notes: string | null;
  created_at: string;
}

const peso = (n: number) =>
  "₱" + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const statusVariant = (s: string): "default" | "secondary" | "destructive" =>
  s === "Approved" ? "default" : s === "Rejected" ? "destructive" : "secondary";

const statusOptions = ["Pending", "Approved", "Rejected", "Withdrawn", "Expired"] as const;

/* ── component ─────────────────────────────────────────── */
const AdminCancellations = () => {
  const { toast } = useToast();

  const [mainTab, setMainTab] = useState<"tenancy" | "bookings">("tenancy");
  const [statusFilter, setStatusFilter] = useState<string>("Pending");

  const loadRequests = useCallback(
    () => getAdminCancellations(statusFilter),
    [statusFilter],
  );
  const {
    data: requests,
    refetch,
    error,
  } = useSupabasePolling<AdminCancellationRequest[]>(loadRequests, 5000, mainTab === "tenancy");

  const loadAllRequests = useCallback(
    () => getAdminCancellations("all"),
    [],
  );
  const { data: allTenancyRequests } = useSupabasePolling<AdminCancellationRequest[]>(
    loadAllRequests,
    5000,
    mainTab === "tenancy",
  );

  const requestCounts = allTenancyRequests?.reduce<Record<string, number>>((acc, request) => {
    acc[request.status] = (acc[request.status] ?? 0) + 1;
    return acc;
  }, {}) ?? {};

  // Poll cancelled guest bookings
  const { data: cancelledBookings, error: bookingsError } = useSupabasePolling<CancelledBooking[]>(
    listAdminCancelledGuestBookings,
    5000,
    mainTab === "bookings",
  );

  const [approveTarget, setApproveTarget] = useState<AdminCancellationRequest | null>(null);
  const [rejectTarget, setRejectTarget] = useState<AdminCancellationRequest | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [busy, setBusy] = useState(false);

  const approve = async () => {
    if (!approveTarget) return;
    setBusy(true);
    try {
      await approveTenantCancellation(approveTarget.cancellation_id);
      toast({ title: "Cancellation approved and refund recorded" });
      setApproveTarget(null);
      void refetch();
    } catch (error) {
      toast({
        title: error instanceof Error ? error.message : "Could not approve cancellation.",
        variant: "destructive",
      });
    } finally { setBusy(false); }
  };

  const reject = async () => {
    if (!rejectTarget) return;
    setBusy(true);
    try {
      await rejectTenantCancellation(rejectTarget.cancellation_id, rejectReason);
      toast({ title: "Cancellation rejected" });
      setRejectTarget(null);
      setRejectReason("");
      void refetch();
    } catch (error) {
      toast({
        title: error instanceof Error ? error.message : "Could not reject cancellation.",
        variant: "destructive",
      });
    } finally { setBusy(false); }
  };

  /* ── render ──────────────────────────────────────────── */
  return (
    <DashboardLayout role="admin">
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="font-display text-2xl font-bold">Cancellations & Refunds</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Review and manage tenancy cancellations and guest booking refunds.
          </p>
        </div>

        {/* Main Tab Toggle */}
        <div className="flex gap-2 border-b border-border pb-4">
          <Button
            variant={mainTab === "tenancy" ? "default" : "outline"}
            onClick={() => setMainTab("tenancy")}
            className="font-semibold text-xs h-9"
          >
            Tenancy Cancellations
          </Button>
          <Button
            variant={mainTab === "bookings" ? "default" : "outline"}
            onClick={() => setMainTab("bookings")}
            className="font-semibold text-xs h-9"
          >
            Booking Cancellations
          </Button>
        </div>

        {mainTab === "tenancy" ? (
          <div className="space-y-6">
            {/* Tenancy Header */}
            <div>
              <h2 className="font-display text-lg font-bold">Active Tenancy Cancellation Requests</h2>
              <p className="text-muted-foreground text-xs mt-0.5">
                Review and act on active lease cancellation requests.
              </p>
            </div>

            {error && (
              <div className="p-3 rounded-md border border-destructive/30 bg-destructive/10 text-destructive text-xs">
                {error}
              </div>
            )}

            {/* Filter tabs */}
            <div className="flex gap-2 flex-wrap">
              {statusOptions.map((s) => {
                const count = requestCounts[s] ?? 0;
                return (
                  <Button
                    key={s}
                    size="sm"
                    variant={statusFilter === s ? "default" : "secondary"}
                    onClick={() => setStatusFilter(s)}
                    className="gap-2"
                  >
                    <span>{s}</span>
                    <span className="inline-flex min-w-5 h-5 items-center justify-center rounded-full bg-background/20 px-1 text-[10px] font-semibold leading-none">
                      {count}
                    </span>
                  </Button>
                );
              })}
            </div>

            {/* Loading */}
            {!requests && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 size={14} className="animate-spin" /> Loading…
              </div>
            )}

            {/* Empty */}
            {requests?.length === 0 && (
              <div className="bg-card border border-border rounded-xl p-10 text-center text-muted-foreground text-sm">
                No {statusFilter.toLowerCase()} cancellation requests.
              </div>
            )}

            {/* Cards */}
            <div className="space-y-4">
              {requests?.map((r) => (
                <div key={r.cancellation_id} className="bg-card border border-border rounded-xl p-5 space-y-4">
                  {/* Top row */}
                  <div className="flex items-start justify-between flex-wrap gap-3">
                    <div className="flex items-start gap-3">
                      <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary shrink-0">
                        <User size={18} />
                      </div>
                      <div>
                        <p className="font-semibold">{r.tenant_name}</p>
                        <p className="text-xs text-muted-foreground">{r.tenant_email} · {r.tenant_phone || "—"}</p>
                      </div>
                    </div>
                    <Badge variant={statusVariant(r.status)}>{r.status}</Badge>
                  </div>

                  {/* Info grid */}
                  <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <InfoCell icon={<BedDouble size={14} />} label="Room" value={`Room ${r.room_number}`} />
                    <InfoCell icon={<CalendarDays size={14} />} label="Check-in" value={r.move_in_date} />
                    <InfoCell icon={<CalendarDays size={14} />} label="Cancellation date" value={r.cancellation_date} />
                    <InfoCell icon={<ArrowLeftRight size={14} />} label="Days consumed" value={`${r.days_consumed} days`} />
                  </div>

                  {/* Refund breakdown */}
                  <div className="border border-border rounded-lg overflow-hidden text-sm">
                    <div className="grid grid-cols-3 divide-x divide-border">
                      <div className="p-3 text-center">
                        <p className="text-xs text-muted-foreground mb-1">Monthly Rent</p>
                        <p className="font-semibold">{peso(r.monthly_rent)}</p>
                      </div>
                      <div className="p-3 text-center">
                        <p className="text-xs text-muted-foreground mb-1">Amount Used</p>
                        <p className="font-semibold text-destructive">− {peso(r.amount_used)}</p>
                      </div>
                      <div className="p-3 text-center bg-primary/5">
                        <p className="text-xs text-muted-foreground mb-1">
                          <Banknote size={12} className="inline mr-1" />Refund
                        </p>
                        <p className="font-bold text-primary">{peso(r.refund_amount)}</p>
                      </div>
                    </div>
                  </div>

                  {/* Expiry / rejection reason */}
                  {r.status === "Pending" && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Clock size={12} />
                      Window expires: {new Date(r.cancellation_expires_at).toLocaleString()}
                    </div>
                  )}
                  {r.status === "Rejected" && r.rejection_reason && (
                    <p className="text-xs text-destructive">Reason: {r.rejection_reason}</p>
                  )}

                  {/* Actions */}
                  {r.status === "Pending" && (
                    <div className="flex gap-2 pt-1">
                      <Button
                        size="sm"
                        className="gap-1.5"
                        onClick={() => setApproveTarget(r)}
                      >
                        <CheckCircle2 size={14} /> Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5 text-destructive border-destructive/40 hover:bg-destructive/10"
                        onClick={() => { setRejectTarget(r); setRejectReason(""); }}
                      >
                        <XCircle size={14} /> Reject
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Bookings Header */}
            <div>
              <h2 className="font-display text-lg font-bold">Guest Booking Cancellations</h2>
              <p className="text-muted-foreground text-xs mt-0.5">
                View all guest bookings that have been cancelled. These may require payment refunds.
              </p>
            </div>

            {bookingsError && (
              <div className="p-3 rounded-md border border-destructive/30 bg-destructive/10 text-destructive text-xs">
                {bookingsError}
              </div>
            )}

            {/* Loading */}
            {!cancelledBookings && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 size={14} className="animate-spin" /> Loading…
              </div>
            )}

            {/* Empty */}
            {cancelledBookings?.length === 0 && (
              <div className="bg-card border border-border rounded-xl p-10 text-center text-muted-foreground text-sm">
                No cancelled guest bookings found.
              </div>
            )}

            {/* Cards */}
            <div className="space-y-4">
              {cancelledBookings?.map((b) => (
                <div key={b.booking_id} className="bg-card border border-border rounded-xl p-5 space-y-4">
                  {/* Top row */}
                  <div className="flex items-start justify-between flex-wrap gap-3">
                    <div className="flex items-start gap-3">
                      <div className="h-10 w-10 rounded-full bg-orange-500/10 flex items-center justify-center text-orange-600 shrink-0">
                        <User size={18} />
                      </div>
                      <div>
                        <p className="font-semibold">{b.full_name}</p>
                        <p className="text-xs text-muted-foreground">{b.email} · {b.phone || "—"}</p>
                      </div>
                    </div>
                    <Badge variant="destructive">Cancelled</Badge>
                  </div>

                  {/* Info grid */}
                  <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <InfoCell icon={<BedDouble size={14} />} label="Room" value={b.room_number ? `Room ${b.room_number}` : "—"} />
                    <InfoCell icon={<CalendarDays size={14} />} label="Intended Move-in" value={b.move_in_date || "—"} />
                    <InfoCell icon={<CalendarDays size={14} />} label="Booked On" value={new Date(b.created_at).toLocaleDateString()} />
                    <InfoCell icon={<Banknote size={14} />} label="Refund Due (Rent)" value={b.monthly_rent ? peso(b.monthly_rent) : "—"} />
                  </div>

                  {/* Payment / Refund Notes */}
                  {b.notes && (
                    <div className="bg-orange-500/5 border border-orange-200/30 dark:border-orange-900/20 rounded-lg p-4 space-y-2">
                      <div className="flex items-center gap-2 text-xs font-semibold text-orange-700 dark:text-orange-400">
                        <AlertTriangle size={14} className="shrink-0" />
                        <span>Payment & Refund Information</span>
                      </div>
                      <p className="text-xs text-muted-foreground font-mono bg-background/50 p-2 rounded border border-border/40 whitespace-pre-wrap leading-relaxed">
                        {b.notes}
                      </p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Approve dialog ── */}
      <Dialog open={!!approveTarget} onOpenChange={() => setApproveTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Approve Cancellation</DialogTitle>
            <DialogDescription>
              This will create a refund payment record, deactivate the tenant, and mark the room as Available.
            </DialogDescription>
          </DialogHeader>
          {approveTarget && (
            <div className="border border-border rounded-lg overflow-hidden text-sm">
              <div className="flex justify-between p-3 bg-muted/40">
                <span className="text-muted-foreground">Tenant</span>
                <span className="font-medium">{approveTarget.tenant_name}</span>
              </div>
              <div className="flex justify-between p-3 border-t border-border">
                <span className="text-muted-foreground">Room</span>
                <span>Room {approveTarget.room_number}</span>
              </div>
              <div className="flex justify-between p-3 border-t border-border bg-primary/5 font-semibold">
                <span>Refund to record</span>
                <span className="text-primary">{peso(approveTarget.refund_amount)}</span>
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="secondary" onClick={() => setApproveTarget(null)}>Cancel</Button>
            <Button onClick={approve} disabled={busy}>
              {busy ? <Loader2 size={14} className="mr-2 animate-spin" /> : <CheckCircle2 size={14} className="mr-2" />}
              Confirm Approval
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Reject dialog ── */}
      <Dialog open={!!rejectTarget} onOpenChange={() => setRejectTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reject Cancellation</DialogTitle>
            <DialogDescription>
              Provide a reason so the tenant understands why the request was denied.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="reject-reason">Rejection reason</Label>
            <Textarea
              id="reject-reason"
              rows={3}
              placeholder="e.g. Insufficient notice period, outstanding balance…"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="secondary" onClick={() => setRejectTarget(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={reject}
              disabled={busy || !rejectReason.trim()}
            >
              {busy ? <Loader2 size={14} className="mr-2 animate-spin" /> : <XCircle size={14} className="mr-2" />}
              Reject Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
};

/* ── sub-component ──────────────────────────────────────── */
function InfoCell({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 p-3 rounded-md bg-muted/40">
      <span className="text-muted-foreground shrink-0">{icon}</span>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="font-medium text-sm truncate">{value}</p>
      </div>
    </div>
  );
}

export default AdminCancellations;
