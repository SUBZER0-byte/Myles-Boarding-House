import { DashboardLayout } from "@/components/DashboardLayout";
import { StatCard } from "@/components/StatCard";
import { BedDouble, CreditCard, Megaphone, Wrench, AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { usePolling } from "@/hooks/usePolling";
import { endpoints, sessionStore } from "@/lib/api";

interface TenantDash {
  tenant_name: string;
  room_info: { room_id: number; room_number: string; room_type: string; monthly_rent: number; status: string } | null;
  current_balance: number;
  next_due_payment: { payment_id: number; amount: number; due_date: string; status: string } | null;
  last_payment: { payment_id: number; amount: number; paid_at: string; method: string } | null;
  announcements: { announcement_id: number; title: string; body: string; created_at: string }[];
  maintenance: { request_id: number; title: string; status: string; created_at: string }[];
  complaints: { complaint_id: number; title: string; status: string; created_at: string }[];
  maintenance_summary: Record<string, number>;
  complaint_summary: Record<string, number>;
}

const complaintStatuses = ["Open", "In Progress", "Resolved", "Cancelled"];
const maintenanceStatuses = ["Pending", "In Progress", "Completed", "Cancelled"];

const peso = (n: number) =>
  "₱" + (n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });

const TenantDashboard = () => {
  const session = sessionStore.get();
  const userId = session?.user_id;

  const { data, error } = usePolling<TenantDash>(
    userId ? `${endpoints.tenantDashboard}?action=get_dashboard_data&user_id=${userId}` : null,
    { intervalMs: 5000 }
  );

  return (
    <DashboardLayout role="tenant">
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold text-slate-800 dark:text-foreground">
              Welcome{data?.tenant_name ? `, ${data.tenant_name.split(" ")[0]}` : ""}!
            </h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-muted-foreground">
              {data?.room_info
                ? `Room ${data.room_info.room_number} · ${data.room_info.room_type}`
                : "Loading your room…"}
            </p>
          </div>
          <div className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 shadow-sm dark:border-border dark:bg-secondary dark:text-secondary-foreground dark:shadow-none">
            Tenant Portal
          </div>
        </div>

        {!userId && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700 dark:border-amber-400/25 dark:bg-amber-400/10 dark:text-amber-200">
            You're not signed in. Please <a className="underline" href="/login">sign in</a> to load your dashboard.
          </div>
        )}
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700 dark:border-red-400/25 dark:bg-red-400/10 dark:text-red-200">
            Backend unreachable: {error}
          </div>
        )}

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard title="My Room" value={data?.room_info?.room_number ?? "—"} icon={BedDouble} variant="primary" />
          <StatCard
            title="Next Payment"
            value={data?.next_due_payment ? peso(data.next_due_payment.amount) : "—"}
            icon={CreditCard}
            trend={data?.next_due_payment ? `Due ${data.next_due_payment.due_date}` : undefined}
            variant="warning"
          />
          <StatCard title="Announcements" value={data?.announcements.length ?? 0} icon={Megaphone} variant="default" />
          <StatCard
            title="Open Requests"
            value={
              (data?.complaint_summary?.Open ?? 0) +
              (data?.complaint_summary?.["In Progress"] ?? 0) +
              (data?.maintenance_summary?.Pending ?? 0) +
              (data?.maintenance_summary?.["In Progress"] ?? 0)
            }
            icon={Wrench}
            variant="success"
          />
        </div>

        <div className="grid lg:grid-cols-2 gap-6">
          {/* Announcements */}
          <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-white via-slate-50 to-white p-5 shadow-[0_18px_35px_rgba(15,23,42,0.04)] dark:border-border dark:from-card dark:via-card dark:to-card dark:shadow-black/10">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-muted-foreground">Noticeboard</p>
                <h2 className="mt-1 font-display text-[1.75rem] font-semibold leading-none text-slate-800 dark:text-foreground">Announcements</h2>
              </div>
              <span className="rounded-full border border-slate-200 bg-slate-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:border-border dark:bg-secondary dark:text-secondary-foreground">
                {data?.announcements?.length ?? 0} updates
              </span>
            </div>
            <div className="space-y-3">
              {!data && (
                <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-muted-foreground">
                  <Loader2 size={14} className="animate-spin" /> Loading…
                </div>
              )}
              {data?.announcements?.length === 0 && (
                <p className="text-xs text-slate-500 dark:text-muted-foreground">No announcements yet.</p>
              )}
              {data?.announcements?.map((a) => (
                <div key={a.announcement_id} className="rounded-xl border border-slate-200 bg-slate-50/80 p-4 dark:border-border dark:bg-muted/60">
                  <div className="mb-2 flex items-center gap-2">
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-orange-100 text-orange-600 dark:bg-orange-400/15 dark:text-orange-300">
                      <Megaphone size={14} />
                    </span>
                    <span className="text-xs font-medium text-slate-500 dark:text-muted-foreground">{new Date(a.created_at).toLocaleDateString()}</span>
                  </div>
                  <p className="text-sm font-semibold text-slate-700 dark:text-foreground">{a.title}</p>
                  <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-muted-foreground">{a.body}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Payments */}
          <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-white via-slate-50 to-white p-5 shadow-[0_18px_35px_rgba(15,23,42,0.04)] dark:border-border dark:from-card dark:via-card dark:to-card dark:shadow-black/10">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-muted-foreground">Finance</p>
                <h2 className="mt-1 font-display text-[1.75rem] font-semibold leading-none text-slate-800 dark:text-foreground">Payments</h2>
              </div>
              <button className="rounded-xl bg-orange-500 px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-orange-600">
                Pay Now
              </button>
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/80 p-3.5 dark:border-border dark:bg-muted/60">
                <div>
                  <p className="text-sm font-medium text-slate-700 dark:text-foreground">Outstanding balance</p>
                  <p className="text-xs text-slate-500 dark:text-muted-foreground">Sum of pending/overdue</p>
                </div>
                <span className="text-sm font-bold text-slate-700 dark:text-foreground">{peso(data?.current_balance ?? 0)}</span>
              </div>
              {data?.last_payment && (
                <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/80 p-3.5 dark:border-border dark:bg-muted/60">
                  <div>
                    <p className="text-sm font-medium text-slate-700 dark:text-foreground">Last payment</p>
                    <p className="text-xs text-slate-500 dark:text-muted-foreground">
                      {new Date(data.last_payment.paid_at).toLocaleDateString()} · {data.last_payment.method}
                    </p>
                  </div>
                  <Badge variant="secondary" className="border border-emerald-200 bg-white text-emerald-700 dark:border-emerald-400/25 dark:bg-emerald-400/10 dark:text-emerald-300">
                    <CheckCircle2 size={10} className="mr-1" />
                    {peso(data.last_payment.amount)}
                  </Badge>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Complaints */}
        <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-white via-slate-50 to-white p-5 shadow-[0_18px_35px_rgba(15,23,42,0.04)] dark:border-border dark:from-card dark:via-card dark:to-card dark:shadow-black/10">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-muted-foreground">Service</p>
                <h2 className="mt-1 font-display text-[1.75rem] font-semibold leading-none text-slate-800 dark:text-foreground">Complaints & Maintenance</h2>
            </div>
          </div>
          <div className="grid lg:grid-cols-2 gap-4">
            {[
              { title: "My Complaints", summary: data?.complaint_summary, statuses: complaintStatuses, icon: AlertCircle },
              { title: "My Maintenance Requests", summary: data?.maintenance_summary, statuses: maintenanceStatuses, icon: Wrench },
            ].map(({ title, summary, statuses, icon: SummaryIcon }) => (
              <div key={title} className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 dark:border-border dark:bg-muted/60">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-slate-700 dark:text-foreground">{title}</h3>
                  <Badge className="border border-slate-200 bg-white text-slate-600 dark:border-border dark:bg-secondary dark:text-secondary-foreground">
                    Total: {Object.values(summary ?? {}).reduce((total, count) => total + count, 0)}
                  </Badge>
                </div>
                <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
                  {statuses.map((status) => (
                    <div key={status} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-border dark:bg-card dark:shadow-none">
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500 dark:bg-secondary dark:text-muted-foreground">
                        <SummaryIcon size={14} />
                      </span>
                      <span className="flex-1 text-xs font-medium text-slate-500 dark:text-muted-foreground">{status}</span>
                      <span className="text-sm font-bold text-slate-700 dark:text-foreground">{summary?.[status] ?? 0}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default TenantDashboard;
