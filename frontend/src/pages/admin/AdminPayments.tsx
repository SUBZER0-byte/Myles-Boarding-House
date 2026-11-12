import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Loader2, CheckCircle2, Clock3, AlertTriangle, CircleDashed, XCircle } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { usePolling } from "@/hooks/usePolling";
import { api, API_BASE_URL, endpoints, type ApiResponse } from "@/lib/api";

interface Payment {
  payment_id: number;
  tenant_id: number;
  full_name: string;
  room_number: string | null;
  amount: number;
  due_date: string;
  paid_at: string | null;
  method: string | null;
  reference_number: string | null;
  has_payment_screenshot: number | boolean;
  status: string;
  display_status: string;
  description: string;
}
interface Summary { status: string; cnt: number; total: number; }
interface Tenant {
  tenant_id: number;
  full_name: string;
  room_number: string | null;
  move_in_date: string | null;
  move_out_date: string | null;
  is_active: number;
}

const paymentStatusStyles: Record<string, { icon: typeof CheckCircle2; trigger: string; dot: string }> = {
  Paid: {
    icon: CheckCircle2,
    trigger: "border-success/30 bg-success/10 text-success hover:bg-success/15",
    dot: "bg-success",
  },
  Pending: {
    icon: Clock3,
    trigger: "border-warning/30 bg-warning/10 text-warning hover:bg-warning/15",
    dot: "bg-warning",
  },
  Overdue: {
    icon: AlertTriangle,
    trigger: "border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/15",
    dot: "bg-destructive",
  },
  Submitted: {
    icon: CircleDashed,
    trigger: "border-primary/25 bg-primary/10 text-primary hover:bg-primary/15",
    dot: "bg-primary",
  },
  Rejected: {
    icon: XCircle,
    trigger: "border-muted-foreground/25 bg-muted text-muted-foreground hover:bg-muted/80",
    dot: "bg-muted-foreground",
  },
};

const AdminPayments = () => {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedTenant, setSelectedTenant] = useState<string>("");
  const { data: tenants, error: tenantsError } = usePolling<Tenant[]>(`${endpoints.adminPayments}?action=tenants`, { intervalMs: 10000 });
  const tenantId = Number(selectedTenant);
  const query = new URLSearchParams({ action: "list", tenant_id: selectedTenant });
  if (statusFilter !== "all") query.set("status", statusFilter);
  const url = selectedTenant ? `${endpoints.adminPayments}?${query.toString()}` : null;
  const { data: payments, refetch, error } = usePolling<Payment[]>(url, { intervalMs: 5000 });
  const { data: summary } = usePolling<Summary[]>(
    selectedTenant ? `${endpoints.adminPayments}?action=summary&tenant_id=${selectedTenant}` : null,
    { intervalMs: 5000 },
  );

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ tenant_id: "", amount: 0, due_date: "", description: "", status: "Pending" });
  const [saving, setSaving] = useState(false);
  const [statusPayment, setStatusPayment] = useState<Payment | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<"Cash" | "GCash">("Cash");
  const [paymentReference, setPaymentReference] = useState("");
  const [statusSaving, setStatusSaving] = useState(false);

  const create = async () => {
    setSaving(true);
    try {
      const res = await api.post<ApiResponse>(`${endpoints.adminPayments}?action=create`, form);
      if (res.data.type === "success") { toast({ title: "Payment created" }); setOpen(false); refetch(); }
      else toast({ title: res.data.message || "Failed", variant: "destructive" });
    } finally { setSaving(false); }
  };

  const updateStatus = async (p: Payment, status: string, method?: "Cash" | "GCash", reference?: string) => {
    try {
      const res = await api.post<ApiResponse>(`${endpoints.adminPayments}?action=update_status`, {
        payment_id: p.payment_id,
        status,
        method,
        reference,
      });
      if (res.data.type !== "success") throw new Error(res.data.message || "Unable to record payment.");
      toast({ title: res.data.message || "Payment record updated" });
      setStatusPayment(null);
      refetch();
    } catch (error) {
      toast({
        title: error instanceof Error ? error.message : "Unable to record payment.",
        variant: "destructive",
      });
    }
  };

  const handleStatusChange = (payment: Payment, status: string) => {
    if (status === "Paid") {
      setStatusPayment(payment);
      setPaymentMethod(payment.method === "GCash" ? "GCash" : "Cash");
      setPaymentReference(payment.reference_number || "");
      return;
    }
    void updateStatus(payment, status);
  };

  const savePaidStatus = async () => {
    if (!statusPayment) return;
    if (paymentMethod === "GCash" && !paymentReference.trim() && !statusPayment?.has_payment_screenshot) {
      toast({ title: "Enter the GCash transaction number", variant: "destructive" });
      return;
    }
    setStatusSaving(true);
    try {
      await updateStatus(statusPayment, "Paid", paymentMethod, paymentReference.trim());
    } finally {
      setStatusSaving(false);
    }
  };

  const remove = async (p: Payment) => {
    const res = await api.post<ApiResponse>(`${endpoints.adminPayments}?action=delete`, { payment_id: p.payment_id });
    toast({ title: res.data.message || "Deleted" }); refetch();
  };

  const generateNextMonth = async () => {
    const res = await api.get<ApiResponse>(`${endpoints.adminPayments}?action=generate_next_month`);
    toast({ title: res.data.message || "Updated" }); refetch();
  };

  return (
    <DashboardLayout role="admin">
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="font-display text-2xl font-bold">Rent Payments</h1>
            <p className="text-muted-foreground text-sm mt-1">Manage tenant rent payments, balances, and payment status.</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button onClick={() => generateNextMonth()} variant="secondary" className="gap-2">Generate Next Month</Button>
            <Button
              onClick={() => {
                setForm(current => ({ ...current, tenant_id: selectedTenant }));
                setOpen(true);
              }}
              disabled={!selectedTenant}
              className="gap-2"
            >
              <Plus size={16} /> Add Payment
            </Button>
          </div>
        </div>
        <div className="bg-card border border-border rounded-lg p-4 space-y-2">
          <Label htmlFor="payment-tenant">Select tenant</Label>
          <Select
            value={selectedTenant}
            onValueChange={value => {
              setSelectedTenant(value);
              setStatusFilter("all");
            }}
          >
            <SelectTrigger id="payment-tenant" className="max-w-xl">
              <SelectValue placeholder="Choose a tenant to view their full payment record" />
            </SelectTrigger>
            <SelectContent>
              {tenants?.map(tenant => (
                <SelectItem key={tenant.tenant_id} value={String(tenant.tenant_id)}>
                  {tenant.full_name} · Room {tenant.room_number || "—"}{Number(tenant.is_active) !== 1 ? " · Inactive" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedTenant && tenants?.find(tenant => tenant.tenant_id === tenantId) && (
            <p className="text-xs text-muted-foreground">
              Stay: {tenants.find(tenant => tenant.tenant_id === tenantId)?.move_in_date || "Not recorded"}
              {" — "}
              {tenants.find(tenant => tenant.tenant_id === tenantId)?.move_out_date || "No checkout date"}
            </p>
          )}
          {tenantsError && <p className="text-xs text-destructive">{tenantsError}</p>}
        </div>
        {error && <div className="p-3 rounded-md border border-destructive/30 bg-destructive/10 text-destructive text-xs">{error}</div>}

        {/* Summary cards */}
        {selectedTenant && <div className="grid sm:grid-cols-3 gap-4">
          {summary?.map((s) => (
            <div key={s.status} className="bg-card border border-border rounded-lg p-4">
              <p className="text-xs text-muted-foreground">{s.status}</p>
              <p className="font-display text-xl font-bold mt-1">{s.cnt}</p>
              <p className="text-xs text-muted-foreground mt-1">₱{Number(s.total).toLocaleString()}</p>
            </div>
          ))}
        </div>}

        {selectedTenant && <div className="flex gap-2 flex-wrap">
          {["all","Pending","Submitted","Overdue","Paid"].map(s => (
            <Button key={s} size="sm" variant={statusFilter === s ? "default" : "secondary"} onClick={() => setStatusFilter(s)}>
              {s === "all" ? "All" : s}
            </Button>
          ))}
        </div>}

        {!selectedTenant && <div className="bg-card border border-border rounded-lg p-8 text-center text-sm text-muted-foreground">Select a tenant to view all payment records from check-in through check-out.</div>}
        {selectedTenant && !payments && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 size={14} className="animate-spin" /> Loading payment records…</div>}
        {selectedTenant && payments?.length === 0 && <div className="bg-card border border-border rounded-lg p-8 text-center text-sm text-muted-foreground">No payment records for this tenant.</div>}
        {selectedTenant && !!payments?.length && <div className="text-sm text-muted-foreground">{payments.length} payment record(s) for this tenant</div>}
        {selectedTenant && <div className="bg-card border border-border rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b border-border">
              <tr>
                <th className="text-left p-3 font-medium text-muted-foreground">Tenant</th>
                <th className="text-left p-3 font-medium text-muted-foreground">Amount</th>
                <th className="text-left p-3 font-medium text-muted-foreground">Due</th>
                <th className="text-left p-3 font-medium text-muted-foreground">Payment details</th>
                <th className="text-left p-3 font-medium text-muted-foreground">Paid</th>
                <th className="text-left p-3 font-medium text-muted-foreground">Status</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {payments?.map((p) => (
                <tr key={p.payment_id} className="border-b border-border last:border-0">
                  <td className="p-3">
                    <p className="font-medium">{p.full_name}</p>
                    <p className="text-xs text-muted-foreground">Room {p.room_number ?? "—"}</p>
                  </td>
                  <td className="p-3 font-semibold">₱{Number(p.amount).toLocaleString()}</td>
                  <td className="p-3 text-muted-foreground">{p.due_date}</td>
                  <td className="p-3 text-muted-foreground">
                    <p>{p.method || "—"}</p>
                    {p.reference_number && <p className="text-xs">Transaction #: {p.reference_number}</p>}
                    {p.has_payment_screenshot && (
                      <a
                        className="text-xs font-medium text-primary underline underline-offset-2"
                        href={`${API_BASE_URL}${endpoints.adminPayments}?action=screenshot&payment_id=${p.payment_id}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        View GCash screenshot
                      </a>
                    )}
                  </td>
                  <td className="p-3 text-muted-foreground">{p.paid_at ?? "—"}</td>
                  <td className="p-3">
                    {(() => {
                      const currentStatus = p.display_status || p.status;
                      const statusStyle = paymentStatusStyles[currentStatus] || paymentStatusStyles.Pending;
                      const StatusIcon = statusStyle.icon;
                      return (
                    <Select
                      value={currentStatus}
                      onValueChange={status => handleStatusChange(p, status)}
                    >
                      <SelectTrigger
                        aria-label={`Change payment status for ${p.full_name}, currently ${currentStatus}`}
                        className={`h-9 min-w-36 rounded-full border px-3 font-medium shadow-sm transition-colors focus:ring-2 focus:ring-ring focus:ring-offset-2 ${statusStyle.trigger}`}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <StatusIcon size={15} aria-hidden="true" />
                          <SelectValue />
                        </span>
                      </SelectTrigger>
                      <SelectContent className="rounded-xl border-border/80 p-1.5 shadow-lg">
                        {["Pending", "Overdue", "Submitted", "Paid", "Rejected"].map(status => {
                          const optionStyle = paymentStatusStyles[status];
                          return (
                            <SelectItem
                              key={status}
                              value={status}
                              className="rounded-lg py-2 pl-8 pr-3 focus:bg-accent"
                            >
                              <span className="flex items-center gap-2.5">
                                <span className={`h-2 w-2 rounded-full ${optionStyle.dot}`} />
                                <span className="font-medium">{status}</span>
                              </span>
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                      );
                    })()}
                  </td>
                  <td className="p-3 text-right">
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => remove(p)}><Trash2 size={14} /></Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add Payment</DialogTitle>
            <DialogDescription>Record a charge for a tenant.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-1.5">
              <Label>Tenant</Label>
              <p className="rounded-md border border-input bg-muted/40 px-3 py-2 text-sm">
                {tenants?.find(tenant => String(tenant.tenant_id) === form.tenant_id)?.full_name || "Select a tenant first"}
              </p>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="grid gap-1.5"><Label>Amount</Label>
                <Input type="number" value={form.amount} onChange={e => setForm({ ...form, amount: +e.target.value })} /></div>
              <div className="grid gap-1.5"><Label>Due Date</Label>
                <Input type="date" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} /></div>
            </div>
            <div className="grid gap-1.5"><Label>Status</Label>
              <Select value={form.status} onValueChange={v => setForm({ ...form, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Pending">Pending</SelectItem>
                  <SelectItem value="Paid">Paid</SelectItem>
                  <SelectItem value="Overdue">Overdue</SelectItem>
                </SelectContent>
              </Select></div>
            <div className="grid gap-1.5"><Label>Description</Label>
              <Input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={create} disabled={saving}>{saving ? "Saving…" : "Create"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!statusPayment} onOpenChange={next => {
        if (!next && !statusSaving) setStatusPayment(null);
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Record payment received</DialogTitle>
            <DialogDescription>
              Choose how payment #{statusPayment?.payment_id} was received. GCash transaction numbers will also appear in the tenant payment record.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-1.5">
              <Label>Payment method</Label>
              <Select value={paymentMethod} onValueChange={(value: "Cash" | "GCash") => setPaymentMethod(value)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Cash">Cash</SelectItem>
                  <SelectItem value="GCash">GCash</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="rent-payment-reference">
                {paymentMethod === "GCash" ? "GCash transaction number (optional with screenshot)" : "Cash receipt / reference number (optional)"}
              </Label>
              <Input
                id="rent-payment-reference"
                maxLength={120}
                value={paymentReference}
                onChange={event => setPaymentReference(event.target.value)}
                placeholder={paymentMethod === "GCash" ? "Enter transaction number" : "Enter receipt number if available"}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setStatusPayment(null)} disabled={statusSaving}>Cancel</Button>
            <Button onClick={savePaidStatus} disabled={statusSaving}>
              {statusSaving && <Loader2 size={14} className="mr-2 animate-spin" />}Save paid status
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </DashboardLayout>
  );
};

export default AdminPayments;
