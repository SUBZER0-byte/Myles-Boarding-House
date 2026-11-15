import { DashboardLayout } from "@/components/DashboardLayout";
import { Loader2, TrendingUp, Users, MessageSquareWarning, Wrench, BarChart3, CalendarDays, CreditCard } from "lucide-react";
import { useAdminAnalytics } from "@/hooks/useAdminAnalytics";
import { Badge } from "@/components/ui/badge";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const formatMonthLabel = (month: string) => {
  if (!month || !month.includes("-")) return month;
  const [year, monthNumber] = month.split("-");
  const index = Number(monthNumber) - 1;
  if (Number.isNaN(index) || index < 0 || index > 11) return month;
  return `${monthNames[index]} ${year}`;
};

const peso = (n: number | string) => "₱" + Number(n).toLocaleString();

const AdminAnalytics = () => {
  const { data, error } = useAdminAnalytics();
  const revenue = data?.revenue;
  const bookings = data?.bookings;
  const occupancy = data?.occupancy;
  const complaints = data?.complaints;
  const maintenance = data?.maintenance;
  const top = data?.top_tenants;

  const totalRevenue = revenue?.reduce((sum, item) => sum + Number(item.total ?? 0), 0) ?? 0;
  const totalNewTenants = occupancy?.reduce((sum, item) => sum + Number(item.new_tenants ?? 0), 0) ?? 0;
  const totalComplaints = complaints?.reduce((sum, item) => sum + Number(item.cnt ?? 0), 0) ?? 0;
  const totalMaintenance = maintenance?.reduce((sum, item) => sum + Number(item.cnt ?? 0), 0) ?? 0;

  const revenueData = (revenue ?? []).map((item) => ({ name: formatMonthLabel(item.month), value: Number(item.total ?? 0) }));
  const bookingsData = (bookings ?? []).map((item) => ({ name: formatMonthLabel(item.month), value: Number(item.total ?? 0) }));
  const occupancyData = (occupancy ?? []).map((item) => ({ name: formatMonthLabel(item.month), value: Number(item.new_tenants ?? 0) }));
  const serviceData = [
    { name: "Complaints", value: Number(totalComplaints) || 0, color: "#ef4444" },
    { name: "Maintenance", value: Number(totalMaintenance) || 0, color: "#f59e0b" },
  ];
  const hasServiceData = serviceData.some((entry) => Number(entry.value) > 0);
  const tenantData = (top ?? []).slice(0, 5).map((tenant) => ({ name: tenant.full_name, amount: Number(tenant.total_paid) }));

  return (
    <DashboardLayout role="admin">
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="font-display text-2xl font-bold text-slate-800 dark:text-foreground">Analytics</h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-muted-foreground">Performance overview for tenants, rooms, and operations.</p>
          </div>
          <div className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 shadow-sm dark:border-border dark:bg-secondary dark:text-secondary-foreground dark:shadow-none">
            Overview
          </div>
        </div>

        {error && (
          <div className="p-3 rounded-md border border-destructive/30 bg-destructive/10 text-destructive text-xs">
            Supabase analytics request failed: {error.message}
          </div>
        )}

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <SummaryCard title="Revenue" value={peso(totalRevenue)} icon={TrendingUp} tone="primary" />
          <SummaryCard title="New Tenants" value={totalNewTenants.toString()} icon={Users} tone="success" />
          <SummaryCard title="Complaints" value={totalComplaints.toString()} icon={MessageSquareWarning} tone="destructive" />
          <SummaryCard title="Maintenance" value={totalMaintenance.toString()} icon={Wrench} tone="warning" />
        </div>

        <div className="grid lg:grid-cols-2 gap-6">
          <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-white via-slate-50 to-white p-5 shadow-[0_18px_35px_rgba(15,23,42,0.04)] dark:border-border dark:from-card dark:via-card dark:to-card dark:shadow-black/10">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-muted-foreground">Finance</p>
                <h2 className="mt-1 font-display text-[1.75rem] font-semibold leading-none text-slate-800 dark:text-foreground">Revenue Trend</h2>
              </div>
              <Badge className="border border-slate-200 bg-slate-100 text-slate-600 dark:border-border dark:bg-secondary dark:text-secondary-foreground">Last 12 months</Badge>
            </div>
            {!revenue ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 size={14} className="animate-spin" /> Loading revenue data…</div>
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={revenueData}>
                    <defs>
                      <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.05} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} />
                    <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(value) => `₱${Number(value) / 1000}k`} />
                    <Tooltip formatter={(value: number | string) => peso(value)} contentStyle={{ backgroundColor: "hsl(var(--popover))", borderColor: "hsl(var(--border))", borderRadius: "0.5rem", color: "hsl(var(--popover-foreground))" }} labelStyle={{ color: "hsl(var(--popover-foreground))" }} />
                    <Area type="monotone" dataKey="value" stroke="#8b5cf6" fill="url(#revenueFill)" strokeWidth={2.5} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-white via-slate-50 to-white p-5 shadow-[0_18px_35px_rgba(15,23,42,0.04)] dark:border-border dark:from-card dark:via-card dark:to-card dark:shadow-black/10">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-muted-foreground">Growth</p>
                <h2 className="mt-1 font-display text-[1.75rem] font-semibold leading-none text-slate-800 dark:text-foreground">Occupancy Trend</h2>
              </div>
              <Badge className="border border-slate-200 bg-slate-100 text-slate-600 dark:border-border dark:bg-secondary dark:text-secondary-foreground">New tenants</Badge>
            </div>
            {!occupancy ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 size={14} className="animate-spin" /> Loading occupancy data…</div>
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={occupancyData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} />
                    <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} />
                    <Tooltip contentStyle={{ backgroundColor: "hsl(var(--popover))", borderColor: "hsl(var(--border))", borderRadius: "0.5rem", color: "hsl(var(--popover-foreground))" }} labelStyle={{ color: "hsl(var(--popover-foreground))" }} />
                    <Line type="monotone" dataKey="value" stroke="#14b8a6" strokeWidth={2.5} dot={{ r: 4 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>

        <div className="grid lg:grid-cols-2 gap-6">
          <div className="rounded-2xl border border-orange-200 bg-gradient-to-br from-orange-50 via-white to-white p-5 shadow-[0_18px_35px_rgba(249,115,22,0.08)] dark:border-orange-400/20 dark:from-orange-950/25 dark:via-card dark:to-card">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-orange-500 dark:text-orange-300">Bookings</p>
                <h2 className="mt-1 font-display text-[1.75rem] font-semibold leading-none text-slate-800 dark:text-foreground">Monthly Bookings</h2>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-100 text-orange-600 dark:bg-orange-400/15 dark:text-orange-300">
                <CalendarDays size={18} />
              </div>
            </div>
            {!bookings ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 size={14} className="animate-spin" /> Loading bookings data…</div>
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={bookingsData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} />
                    <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} allowDecimals={false} />
                    <Tooltip formatter={(value: number | string) => `${value} bookings`} contentStyle={{ backgroundColor: "hsl(var(--popover))", borderColor: "hsl(var(--border))", borderRadius: "0.5rem", color: "hsl(var(--popover-foreground))" }} labelStyle={{ color: "hsl(var(--popover-foreground))" }} />
                    <Bar dataKey="value" radius={[8, 8, 0, 0]} fill="#f97316" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50 via-white to-white p-5 shadow-[0_18px_35px_rgba(139,92,246,0.08)] dark:border-sky-400/20 dark:from-sky-950/25 dark:via-card dark:to-card">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-500 dark:text-sky-300">Payments</p>
                <h2 className="mt-1 font-display text-[1.75rem] font-semibold leading-none text-slate-800 dark:text-foreground">Monthly Rent Payments</h2>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-100 text-violet-600 dark:bg-sky-400/15 dark:text-sky-300">
                <CreditCard size={18} />
              </div>
            </div>
            {!revenue ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 size={14} className="animate-spin" /> Loading payment data…</div>
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={revenueData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} />
                    <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(value) => `₱${Number(value) / 1000}k`} />
                    <Tooltip formatter={(value: number | string) => peso(value)} contentStyle={{ backgroundColor: "hsl(var(--popover))", borderColor: "hsl(var(--border))", borderRadius: "0.5rem", color: "hsl(var(--popover-foreground))" }} labelStyle={{ color: "hsl(var(--popover-foreground))" }} />
                    <Line type="monotone" dataKey="value" stroke="#8b5cf6" strokeWidth={3} dot={{ r: 4 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>

        <div className="grid lg:grid-cols-2 gap-6">
          <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-white via-slate-50 to-white p-5 shadow-[0_18px_35px_rgba(15,23,42,0.04)] dark:border-border dark:from-card dark:via-card dark:to-card dark:shadow-black/10">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-muted-foreground">Operations</p>
                <h2 className="mt-1 font-display text-[1.75rem] font-semibold leading-none text-slate-800 dark:text-foreground">Service Summary</h2>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-500 dark:bg-secondary dark:text-muted-foreground">
                <BarChart3 size={18} />
              </div>
            </div>
            {!hasServiceData ? (
              <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
                No service records found yet.
              </div>
            ) : (
              <>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={serviceData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={3}>
                        {serviceData.map((entry) => (
                          <Cell key={entry.name} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value: number | string) => `${value}`} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-2 flex flex-wrap gap-3 text-sm">
                  {serviceData.map((entry) => (
                    <div key={entry.name} className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
                      <span>{entry.name}: {entry.value}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-white via-slate-50 to-white p-5 shadow-[0_18px_35px_rgba(15,23,42,0.04)] dark:border-border dark:from-card dark:via-card dark:to-card dark:shadow-black/10">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-muted-foreground">Members</p>
                <h2 className="mt-1 font-display text-[1.75rem] font-semibold leading-none text-slate-800 dark:text-foreground">Top Paying Tenants</h2>
              </div>
              <Badge className="border border-slate-200 bg-slate-100 text-slate-600 dark:border-border dark:bg-secondary dark:text-secondary-foreground">Highest contributors</Badge>
            </div>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={tenantData} layout="vertical" margin={{ top: 5, right: 20, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                  <XAxis type="number" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(value) => peso(value)} />
                  <YAxis type="category" dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} width={120} />
                  <Tooltip formatter={(value: number | string) => peso(value)} contentStyle={{ backgroundColor: "hsl(var(--popover))", borderColor: "hsl(var(--border))", borderRadius: "0.5rem", color: "hsl(var(--popover-foreground))" }} labelStyle={{ color: "hsl(var(--popover-foreground))" }} />
                  <Bar dataKey="amount" radius={[0, 6, 6, 0]} fill="#8b5cf6" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

function SummaryCard({ title, value, icon: Icon, tone }: { title: string; value: string; icon: React.ElementType; tone: "primary" | "success" | "destructive" | "warning" }) {
  const toneClasses = {
    primary: "bg-primary/10 text-primary",
    success: "bg-success/10 text-success",
    destructive: "bg-destructive/10 text-destructive",
    warning: "bg-warning/10 text-warning",
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-white via-slate-50 to-white p-4 shadow-[0_14px_26px_rgba(15,23,42,0.04)] dark:border-border dark:from-card dark:via-card dark:to-card dark:shadow-black/10">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-slate-500 dark:text-muted-foreground">{title}</span>
        <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${toneClasses[tone]}`}><Icon size={18} /></div>
      </div>
      <div className="mt-4 text-2xl font-display font-bold tracking-tight text-slate-800 dark:text-foreground">{value}</div>
    </div>
  );
}

export default AdminAnalytics;
