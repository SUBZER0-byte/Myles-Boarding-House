import { DashboardLayout } from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { CreditCard, Trash2, Loader2 } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { usePolling } from "@/hooks/usePolling";
import { API_BASE_URL, api, type ApiResponse } from "@/lib/api";

interface Booking {
  booking_id: number;
  full_name: string;
  email: string;
  phone: string | null;
  room_id: number | null;
  room_number: string | null;
  reservation_type?: "capacity_based" | "entire_room";
  occupant_count?: number;
  monthly_rent: number | null;
  move_in_date: string | null;
  check_out_date: string | null;
  payment_plan: string;
  total_rent: number;
  amount_paid: number;
  next_payment_due: string | null;
  status: string;
  notes: string | null;
  created_at: string;
  gcash_submitted_reference?: string | null;
  gcash_submitted_screenshot?: string | null;
}

interface ExtensionRequest {
  request_id: number;
  booking_id: number;
  original_check_out_date: string;
  requested_check_out_date: string;
  status: "Pending" | "Approved" | "Rejected";
  created_at: string;
  full_name: string;
  email: string;
  room_number: string | null;
  monthly_rent: number | null;
}

const AdminGuestBookingPayments = () => {
  const { toast } = useToast();
  const { data: bookings, refetch, error } = usePolling<Booking[]>("/Admin/bookings.php?action=list", { intervalMs: 5000 });
  const { data: extensionRequests, refetch: refetchExtensions } = usePolling<ExtensionRequest[]>("/Admin/bookings.php?action=extension_requests", { intervalMs: 5000 });
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selected, setSelected] = useState<Booking | null>(null);
  const [form, setForm] = useState({ amount: "", method: "GCash", reference: "" });

  const openPayment = (b: Booking) => {
    setSelected(b);
    setForm({ amount: String(b.monthly_rent || 0), method: "GCash", reference: "" });
    setPaymentOpen(true);
  };

  const recordPayment = async () => {
    if (!selected) return;
    const res = await api.post<ApiResponse>("/Admin/bookings.php?action=record_payment", {
      booking_id: selected.booking_id,
      amount: parseFloat(form.amount),
      method: form.method,
      reference: form.reference,
    });
    if (res.data.type === "success") {
      toast({ title: "Payment recorded" });
      setPaymentOpen(false);
      refetch();
    } else {
      toast({ title: res.data.message || "Failed", variant: "destructive" });
    }
  };

  const confirmInitialGcashPayment = async (booking: Booking) => {
    const res = await api.post<ApiResponse>("/Admin/bookings.php?action=confirm_initial_gcash_payment", {
      booking_id: booking.booking_id,
      reference: booking.gcash_submitted_reference || "",
    });
    if (res.data.type === "success") {
      toast({ title: res.data.message || "GCash payment confirmed" });
      refetch();
    } else {
      toast({ title: res.data.message || "Could not confirm payment", variant: "destructive" });
    }
  };

  const rejectInitialGcashPayment = async (booking: Booking) => {
    const res = await api.post<ApiResponse>("/Admin/bookings.php?action=reject_initial_gcash_payment", {
      booking_id: booking.booking_id,
    });
    if (res.data.type === "success") {
      toast({ title: res.data.message || "GCash payment rejected" });
      refetch();
    } else {
      toast({ title: res.data.message || "Could not reject payment", variant: "destructive" });
    }
  };

  const updateStatus = async (b: Booking, status: string) => {
    const res = await api.post<ApiResponse>("/Admin/bookings.php?action=update_status", {
      booking_id: b.booking_id,
      status,
    });
    if (res.data.type === "success") refetch();
    else toast({ title: res.data.message || "Failed to update", variant: "destructive" });
  };

  const deleteBooking = async () => {
    if (!selected) return;
    const res = await api.post<ApiResponse>("/Admin/bookings.php?action=delete", {
      booking_id: selected.booking_id,
    });
    if (res.data.type === "success") {
      toast({ title: "Booking deleted" });
      setDeleteOpen(false);
      setSelected(null);
      refetch();
    }
  };

  const decideExtension = async (request: ExtensionRequest, decision: "Approved" | "Rejected") => {
    const res = await api.post<ApiResponse>("/Admin/bookings.php?action=extension_decision", {
      request_id: request.request_id,
      decision,
    });
    if (res.data.type === "success") {
      toast({ title: res.data.message || `Extension ${decision.toLowerCase()}` });
      refetchExtensions();
      refetch();
    } else {
      toast({ title: res.data.message || "Could not process extension request", variant: "destructive" });
    }
  };

  const variant = (s: string): "default" | "secondary" | "destructive" =>
    s === "Confirmed" ? "default" : s === "Cancelled" ? "destructive" : "secondary";

  return (
    <DashboardLayout role="admin">
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="font-display text-2xl font-bold">Guest Booking Payments</h1>
            <p className="text-muted-foreground text-sm mt-1">Review and manage payments for guest bookings.</p>
          </div>
        </div>
        {error && <div className="p-3 rounded-md border border-destructive/30 bg-destructive/10 text-destructive text-xs">{error}</div>}
        {!bookings && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 size={14} className="animate-spin" /> Loading…</div>}

        {!!extensionRequests?.length && (
          <section className="space-y-3">
            <div>
              <h2 className="font-display text-lg font-semibold">Stay Extension Requests</h2>
              <p className="text-sm text-muted-foreground">Approve or reject tenant-requested move-out date changes.</p>
            </div>
            {extensionRequests.map((request) => (
              <div key={request.request_id} className="bg-card border border-border rounded-lg p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{request.full_name} <span className="text-muted-foreground font-normal">· Room {request.room_number || "—"}</span></p>
                    <p className="text-xs text-muted-foreground">{request.email} · Booking #{request.booking_id}</p>
                  </div>
                  <Badge variant={request.status === "Pending" ? "secondary" : request.status === "Rejected" ? "destructive" : "default"}>
                    {request.status}
                  </Badge>
                </div>
                <div className="grid sm:grid-cols-3 gap-3 my-3 text-sm">
                  <p><span className="text-muted-foreground">Current move-out:</span> {request.original_check_out_date}</p>
                  <p><span className="text-muted-foreground">Requested:</span> <strong>{request.requested_check_out_date}</strong></p>
                  <p><span className="text-muted-foreground">Rent:</span> ₱{Number(request.monthly_rent || 0).toLocaleString()}/month</p>
                </div>
                {request.status === "Pending" && (
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="secondary" onClick={() => decideExtension(request, "Rejected")}>Reject</Button>
                    <Button size="sm" onClick={() => decideExtension(request, "Approved")}>Approve Extension</Button>
                  </div>
                )}
              </div>
            ))}
          </section>
        )}

        <div className="space-y-3">
          {bookings?.map((b) => (
            <div key={b.booking_id} className="relative bg-card border border-border rounded-lg p-5">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-medium">{b.full_name}</h3>
                    <Badge variant={variant(b.status)} className="text-xs">{b.status}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{b.email} · {b.phone || "—"}</p>
                </div>
              </div>
              {/* Delete button placed at top-right of card */}
              <div className="absolute top-3 right-3">
                <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => { setSelected(b); setDeleteOpen(true); }}>
                  <Trash2 size={14} />
                </Button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3 text-sm">
                <div className="bg-muted/50 rounded p-2">
                  <p className="text-xs text-muted-foreground">Room</p>
                  <p className="font-semibold">{b.room_number || "—"}</p>
                </div>
                <div className="bg-muted/50 rounded p-2">
                  <p className="text-xs text-muted-foreground">Move-in</p>
                  <p className="font-semibold text-xs">{b.move_in_date ? new Date(b.move_in_date).toLocaleDateString() : "—"}</p>
                </div>
                <div className="bg-muted/50 rounded p-2">
                  <p className="text-xs text-muted-foreground">Check-out</p>
                  <p className="font-semibold text-xs">{b.check_out_date || "—"}</p>
                </div>
                <div className="bg-muted/50 rounded p-2">
                  <p className="text-xs text-muted-foreground">Total / Paid</p>
                  <p className="font-semibold text-xs">₱{Number(b.total_rent || 0).toLocaleString()} / ₱{Number(b.amount_paid || 0).toLocaleString()}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3 text-xs text-muted-foreground">
                <span>Plan: <strong className="text-foreground">{b.payment_plan || "—"}</strong></span>
                <span>Reservation: <strong className="text-foreground">{b.reservation_type === "entire_room" ? "Entire room" : "By capacity"} · {Number(b.occupant_count || 1)} occupant{Number(b.occupant_count || 1) === 1 ? "" : "s"}</strong></span>
                <span>Balance: <strong className="text-foreground">₱{Math.max(0, Number(b.total_rent || 0) - Number(b.amount_paid || 0)).toLocaleString()}</strong></span>
                <span>Next due: <strong className="text-foreground">{b.next_payment_due || "—"}</strong></span>
              </div>

              {b.notes && (
                <div className="mb-3 p-2 rounded bg-muted/50 border border-border text-xs">
                  <p className="text-muted-foreground">{b.notes}</p>
                </div>
              )}

              {(b.gcash_submitted_reference || b.gcash_submitted_screenshot) && (
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-warning/30 bg-warning/10 p-3 text-sm">
                  <div className="space-y-1">
                    <p>
                      {["Pending", "Pending Verification"].includes(b.status)
                        ? "GCash payment awaiting review"
                        : `GCash payment submitted before booking status changed to ${b.status}`}
                      {b.gcash_submitted_reference && <> · Reference: <strong>{b.gcash_submitted_reference}</strong></>}
                    </p>
                    {b.gcash_submitted_screenshot && (
                      <a
                        className="text-primary underline"
                        href={`${API_BASE_URL}/uploads/${b.gcash_submitted_screenshot}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        View payment proof
                      </a>
                    )}
                  </div>
                  {["Pending", "Pending Verification"].includes(b.status) && (
                    <div className="flex gap-2">
                      <Button size="sm" variant="destructive" onClick={() => rejectInitialGcashPayment(b)}>
                        Reject Payment
                      </Button>
                      <Button size="sm" onClick={() => confirmInitialGcashPayment(b)}>
                        Confirm GCash Payment
                      </Button>
                    </div>
                  )}
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                {["Confirmed", "Cancelled", "Pending Verification", "Rejected", "Expired"].includes(b.status) ? (
                  <div className="flex-1 min-w-[180px] rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                    Status locked: {b.status}
                  </div>
                ) : (
                  <Select value={b.status} onValueChange={(v) => updateStatus(b, v)}>
                    <SelectTrigger className="h-8 flex-1 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Pending">Pending</SelectItem>
                      <SelectItem value="Confirmed">Confirmed</SelectItem>
                      <SelectItem value="Checked In">Checked In</SelectItem>
                      <SelectItem value="Active">Active</SelectItem>
                      <SelectItem value="Checked Out">Checked Out</SelectItem>
                      <SelectItem value="Cancelled">Cancelled</SelectItem>
                    </SelectContent>
                  </Select>
                )}
                <Button size="sm" variant="secondary" className="gap-2" onClick={() => openPayment(b)}>
                  <CreditCard size={14} /> Record Payment
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Record Payment Dialog */}
      <Dialog open={paymentOpen} onOpenChange={setPaymentOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Record Payment</DialogTitle>
            <DialogDescription>{selected?.full_name} · Room {selected?.room_number}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-1.5">
              <Label>Amount (₱)</Label>
              <Input
                type="number"
                min={0}
                step={0.01}
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Payment Method</Label>
              <Select value={form.method} onValueChange={(v) => setForm({ ...form, method: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="GCash">GCash</SelectItem>
                  <SelectItem value="Bank Transfer">Bank Transfer</SelectItem>
                  <SelectItem value="Cash">Cash</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Reference Number</Label>
              <Input
                placeholder="Transaction/Receipt ID"
                value={form.reference}
                onChange={(e) => setForm({ ...form, reference: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setPaymentOpen(false)}>Cancel</Button>
            <Button onClick={recordPayment}>Record</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Booking?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the booking for {selected?.full_name}. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setSelected(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={deleteBooking}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
};

export default AdminGuestBookingPayments;
