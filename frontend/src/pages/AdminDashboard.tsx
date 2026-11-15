import { DashboardLayout } from "@/components/DashboardLayout";
import { StatCard } from "@/components/StatCard";
import { Users, BedDouble, CreditCard, Wrench, MessageSquareWarning, AlertCircle, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

interface DashData {
  totalRooms: number;
  occupiedRooms: number;
  availableRooms: number;
  reservedRooms: number;
  totalTenants: number;
  monthlyRevenue: number;
  pendingPayments: number;
  openComplaints: number;
  complaintStats: {
    open: number;
    inProgress: number;
    resolved: number;
    cancelled: number;
  };
  pendingMaintenance: number;
  ongoingMaintenance: number;
  completedMaintenance: number;
  cancelledMaintenance: number;
  maintenanceRooms: number;
}

interface Activity {
  type: string;
  message: string;
  timestamp: string;
}

interface DashboardResponse {
  type: "success" | "error";
  message?: string;
  data?: DashData;
  activities?: Activity[];
}

const peso = (n: number) =>
  "₱" + (n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });

const AdminDashboard = () => {
  const [data, setData] = useState<DashData | null>(null);
  const [activities, setActivities] = useState<Activity[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let requestPending = false;

    const loadDashboard = async () => {
      if (requestPending) return;
      requestPending = true;
      try {
        const { data: response, error: requestError } = await supabase.functions.invoke<DashboardResponse>(
          "admin-dashboard",
          { body: {} },
        );
        if (requestError) throw requestError;
        if (response?.type !== "success" || !response.data || !response.activities) {
          throw new Error(response?.message || "Supabase returned an invalid dashboard response.");
        }
        if (!active) return;
        setData(response.data);
        setActivities(response.activities);
        setError(null);
      } catch (requestError) {
        if (!active) return;
        setError(requestError instanceof Error ? requestError.message : "Could not load dashboard data.");
      } finally {
        requestPending = false;
      }
    };

    void loadDashboard();
    const intervalId = window.setInterval(() => {
      if (!document.hidden) void loadDashboard();
    }, 5000);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, []);

  return (
    <DashboardLayout role="admin">
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="font-display text-2xl font-bold">Admin Dashboard</h1>
            <p className="text-muted-foreground text-sm mt-1">Welcome back! Here's your boarding house overview.</p>
          </div>
        </div>

        {error && (
          <div className="p-3 rounded-md border border-destructive/30 bg-destructive/10 text-destructive text-xs">
            Supabase dashboard request failed: {error}
          </div>
        )}

        {/* Stats */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard title="Total Tenants" value={data?.totalTenants ?? "—"} icon={Users} variant="primary" />
          <StatCard title="Available Rooms" value={data?.availableRooms ?? "—"} icon={BedDouble} variant="success" />
          <StatCard title="Monthly Revenue" value={data ? peso(data.monthlyRevenue) : "—"} icon={CreditCard} variant="warning" />
          <StatCard title="Open Requests" value={(data?.openComplaints ?? 0) + (data?.pendingMaintenance ?? 0) + (data?.ongoingMaintenance ?? 0)} icon={Wrench} variant="default" />
        </div>

        <div className="grid lg:grid-cols-2 gap-6">
          {/* Occupancy snapshot */}
          <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-white via-slate-50 to-white p-5 shadow-[0_18px_35px_rgba(15,23,42,0.04)] dark:border-border dark:from-card dark:via-card dark:to-card dark:shadow-black/10">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-muted-foreground">Overview</p>
                <h2 className="mt-1 font-display text-[1.9rem] font-semibold leading-none text-slate-800 dark:text-foreground">Occupancy</h2>
              </div>
              <Badge className="rounded-xl border border-slate-200 bg-slate-100 px-3 py-1.5 text-sm font-semibold text-slate-700 shadow-inner shadow-slate-200/80 dark:border-border dark:bg-secondary dark:text-secondary-foreground dark:shadow-none">
                {data?.totalRooms ?? 0} rooms
              </Badge>
            </div>
            <div className="space-y-3">
              <Row label="Occupied" value={data?.occupiedRooms ?? 0} tone="default" />
              <Row label="Available" value={data?.availableRooms ?? 0} tone="secondary" />
              <Row label="Reserved" value={data?.reservedRooms ?? 0} tone="secondary" />
              <Row label="Maintenance" value={data?.maintenanceRooms ?? 0} tone="default" />
            </div>
          </div>

          {/* Rent collection */}
          <div className="bg-card border border-border rounded-lg p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display font-semibold">Rent Collection</h2>
              <CreditCard size={18} className="text-muted-foreground" />
            </div>
            <div className="space-y-3">
              <Row label="Pending / Overdue Rent" value={data?.pendingPayments ?? 0} tone="destructive" />
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              This shows unpaid or overdue tenant rent charges from the payments ledger. It is not a room-status count.
            </p>
          </div>

          {/* Recent activity (live) */}
          <div className="bg-card border border-border rounded-lg p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display font-semibold">Recent Activity</h2>
              <MessageSquareWarning size={18} className="text-muted-foreground" />
            </div>
            <div className="space-y-3">
              {!activities && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 size={14} className="animate-spin" /> Loading…
                </div>
              )}
              {activities?.length === 0 && (
                <p className="text-xs text-muted-foreground">No recent activity.</p>
              )}
              {activities?.map((a, i) => (
                <div key={i} className="flex items-start gap-3 p-3 rounded-md bg-muted/50">
                  <AlertCircle size={16} className={`mt-0.5 ${a.type === "complaint" ? "text-destructive" : "text-primary"}`} />
                  <div className="flex-1">
                    <p className="text-sm">{a.message}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{new Date(a.timestamp).toLocaleString()}</p>
                  </div>
                  <Badge variant="secondary" className="text-xs capitalize">{a.type}</Badge>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="grid lg:grid-cols-2 gap-6">
          <div className="bg-card border border-border rounded-lg p-5">
            <div className="flex items-center gap-2 mb-4">
              <MessageSquareWarning size={16} className="text-destructive" />
              <h2 className="font-display font-semibold">Complaint Summary</h2>
            </div>
            <div className="space-y-3">
              <Row label="Submitted / Acknowledged" value={data?.complaintStats.open ?? 0} tone="destructive" />
              <Row label="In Progress" value={data?.complaintStats.inProgress ?? 0} tone="default" />
              <Row label="Resolved" value={data?.complaintStats.resolved ?? 0} tone="secondary" />
              <Row label="Cancelled" value={data?.complaintStats.cancelled ?? 0} tone="secondary" />
            </div>
          </div>
          <div className="bg-card border border-border rounded-lg p-5">
            <div className="flex items-center gap-2 mb-4">
              <Wrench size={16} className="text-primary" />
              <h2 className="font-display font-semibold">Maintenance Summary</h2>
            </div>
            <div className="space-y-3">
              <Row label="Submitted / Acknowledged" value={data?.pendingMaintenance ?? 0} tone="destructive" />
              <Row label="In Progress" value={data?.ongoingMaintenance ?? 0} tone="default" />
              <Row label="Completed" value={data?.completedMaintenance ?? 0} tone="secondary" />
              <Row label="Cancelled" value={data?.cancelledMaintenance ?? 0} tone="secondary" />
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

function Row({ label, value, tone }: { label: string; value: number | string; tone: "default" | "secondary" | "destructive" }) {
  const palette = {
    default: {
      row: "border-orange-200 bg-orange-50/80 dark:border-orange-400/20 dark:bg-orange-950/25",
      dot: "bg-orange-500",
      text: "text-slate-700 dark:text-foreground",
      badge: "border border-orange-200 bg-white text-orange-600 shadow-sm dark:border-orange-400/25 dark:bg-orange-400/10 dark:text-orange-300 dark:shadow-none",
    },
    secondary: {
      row: "border-emerald-200 bg-emerald-50/80 dark:border-emerald-400/20 dark:bg-emerald-950/25",
      dot: "bg-emerald-500",
      text: "text-slate-700 dark:text-foreground",
      badge: "border border-emerald-200 bg-white text-emerald-600 shadow-sm dark:border-emerald-400/25 dark:bg-emerald-400/10 dark:text-emerald-300 dark:shadow-none",
    },
    destructive: {
      row: "border-red-200 bg-red-50/80 dark:border-red-400/20 dark:bg-red-950/25",
      dot: "bg-red-500",
      text: "text-slate-700 dark:text-foreground",
      badge: "border border-red-200 bg-white text-red-600 shadow-sm dark:border-red-400/25 dark:bg-red-400/10 dark:text-red-300 dark:shadow-none",
    },
  } as const;

  const style = palette[tone];

  return (
    <div className={`group flex items-center justify-between gap-3 rounded-xl border p-3.5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md ${style.row}`}>
      <div className="flex items-center gap-3">
        <span className={`h-2.5 w-2.5 rounded-full ${style.dot}`} />
        <span className={`text-sm font-medium ${style.text}`}>{label}</span>
      </div>
      <span className={`inline-flex h-9 min-w-9 items-center justify-center rounded-full px-2.5 text-sm font-bold ${style.badge}`}>
        {value}
      </span>
    </div>
  );
}

export default AdminDashboard;
