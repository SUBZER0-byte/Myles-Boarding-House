import { DashboardLayout } from "@/components/DashboardLayout";
import { StatCard } from "@/components/StatCard";
import { BedDouble, MapPin, Heart, Loader2, ReceiptText, Clock, CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { usePolling } from "@/hooks/usePolling";
import { readSavedRoomIds } from "@/lib/savedRooms";
import { endpoints, sessionStore } from "@/lib/api";

interface PublicRoom {
  room_id: number;
  room_number: string;
  room_type: string;
  monthly_rent: number;
  status: string;
}
interface Booking {
  booking_id: number;
  room_number: string;
  room_type: string;
  move_in_date: string;
  status: "Pending" | "Confirmed" | "Cancelled";
  created_at: string;
}

type StatusKey = "Pending" | "Confirmed" | "Cancelled";

const statusStyles: Record<StatusKey, { badge: string; icon: React.ReactNode }> = {
  Pending: {
    badge: "bg-warning/15 text-warning border-warning/30",
    icon: <Clock size={14} className="inline mr-1" />,
  },
  Confirmed: {
    badge: "bg-success/15 text-success border-success/30",
    icon: <CheckCircle2 size={14} className="inline mr-1" />,
  },
  Cancelled: {
    badge: "bg-destructive/15 text-destructive border-destructive/30",
    icon: <XCircle size={14} className="inline mr-1" />,
  },
};

const peso = (n: number) =>
  "₱" + (n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });

const GuestDashboard = () => {
  const session = sessionStore.get();
  const name = session?.username || "Guest";
  const email = session?.email || "";

  const { data: rooms } = usePolling<PublicRoom[]>(
    `${endpoints.publicRooms}?action=list`,
    { intervalMs: 15000 }
  );
  const { data: bookings } = usePolling<Booking[]>(
    email ? `${endpoints.guestBooking}?action=check&email=${encodeURIComponent(email)}` : null,
    { intervalMs: 15000 }
  );

  const available = (rooms || []).filter((r) => (r.status || "").toLowerCase() === "available");
  const savedCount = typeof window !== "undefined" ? readSavedRoomIds().length : 0;
  const activeBookings = (bookings || []).filter((b) => b.status !== "Cancelled");
  const recentBookings = activeBookings.slice(0, 3);

  return (
    <DashboardLayout role="guest">
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold text-slate-800 dark:text-foreground">
              Welcome, {String(name).split(" ")[0]}!
            </h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-muted-foreground">
              Browse rooms and find your next home.
            </p>
          </div>
          <div className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 shadow-sm dark:border-border dark:bg-secondary dark:text-secondary-foreground dark:shadow-none">
            Guest Panel
          </div>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard title="Available Rooms" value={available.length} icon={BedDouble} variant="primary" />
          <StatCard title="Saved" value={savedCount} icon={Heart} variant="warning" />
          <StatCard title="My Booking" value={activeBookings.length > 0 ? `${activeBookings.length}` : "None"} icon={ReceiptText} variant="success" />
        </div>

        <div className="grid lg:grid-cols-2 gap-6">
          <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-white via-slate-50 to-white p-5 shadow-[0_18px_35px_rgba(15,23,42,0.04)] dark:border-border dark:from-card dark:via-card dark:to-card dark:shadow-black/10">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-muted-foreground">Listings</p>
                <h2 className="mt-1 font-display text-[1.75rem] font-semibold leading-none text-slate-800 dark:text-foreground">Available Rooms</h2>
              </div>
              <Link to="/guest/rooms" className="text-xs font-semibold text-orange-600 hover:text-orange-700 dark:text-orange-300 dark:hover:text-orange-200">View all</Link>
            </div>
            <div className="space-y-3">
              {!rooms && (
                <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-muted-foreground">
                  <Loader2 size={14} className="animate-spin" /> Loading…
                </div>
              )}
              {rooms && available.length === 0 && (
                <p className="text-xs text-slate-500 dark:text-muted-foreground">No rooms available at the moment.</p>
              )}
              {available.slice(0, 4).map((r) => (
                <div key={r.room_id} className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/80 p-3.5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md dark:border-border dark:bg-muted/60 dark:hover:bg-muted">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-400/15 dark:text-emerald-300">
                      <BedDouble size={16} />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-700 dark:text-foreground">Room {r.room_number}</p>
                      <p className="truncate text-xs text-slate-500 dark:text-muted-foreground">{r.room_type}</p>
                    </div>
                  </div>
                  <span className="shrink-0 whitespace-nowrap text-right text-sm font-bold text-slate-700 dark:text-foreground">{peso(r.monthly_rent)}/mo</span>
                </div>
              ))}
            </div>
          </div>

        </div>

        {/* My Booking status widget */}
        <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-white via-slate-50 to-white p-5 shadow-[0_18px_35px_rgba(15,23,42,0.04)] dark:border-border dark:from-card dark:via-card dark:to-card dark:shadow-black/10">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-muted-foreground">Bookings</p>
              <h2 className="mt-1 font-display text-[1.75rem] font-semibold leading-none text-slate-800 dark:text-foreground">My Bookings</h2>
            </div>
            <Link to="/guest/booking" className="text-xs font-semibold text-orange-600 hover:text-orange-700 dark:text-orange-300 dark:hover:text-orange-200">View details</Link>
          </div>
          {!bookings && email && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 size={13} className="animate-spin" /> Loading…
            </div>
          )}
          {bookings && activeBookings.length === 0 && (
            <div className="text-xs text-muted-foreground">
              No active booking.{" "}
              <Link to="/guest/rooms" className="text-primary underline">Browse rooms</Link> to make a reservation.
            </div>
          )}
          {recentBookings.length > 0 && (
            <div className="space-y-3">
              {recentBookings.map((b) => {
                const style = statusStyles[b.status as StatusKey] ?? statusStyles.Pending;
                return (
                  <div key={b.booking_id} className="bg-card border border-border rounded-xl p-4 space-y-3">
                    <div className="flex items-start justify-between flex-wrap gap-3">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                          <BedDouble size={18} className="text-primary" />
                        </div>
                        <div>
                          <p className="font-display font-semibold text-base">Room {b.room_number}</p>
                          <p className="text-xs text-muted-foreground">{b.room_type}</p>
                        </div>
                      </div>
                      <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${style.badge}`}>
                        {style.icon}
                        {b.status}
                      </span>
                    </div>

                    <div className="grid sm:grid-cols-2 gap-3">
                      <div className="flex items-center gap-2 p-3 rounded-md bg-muted/40">
                        <span className="text-muted-foreground"><Clock size={14} /></span>
                        <div>
                          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Move-in</p>
                          <p className="text-sm font-medium">{b.move_in_date}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 p-3 rounded-md bg-muted/40">
                        <span className="text-muted-foreground"><ReceiptText size={14} /></span>
                        <div>
                          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Booked</p>
                          <p className="text-sm font-medium">{new Date(b.created_at).toLocaleDateString()}</p>
                        </div>
                      </div>
                    </div>

                    {b.status === "Pending" && (
                      <div className="flex items-start gap-2 p-3 rounded-md bg-warning/10 border border-warning/30 text-warning text-xs">
                        <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                        Waiting for admin confirmation.
                      </div>
                    )}
                    {b.status === "Confirmed" && (
                      <div className="flex items-start gap-2 p-3 rounded-md bg-success/10 border border-success/30 text-success text-xs">
                        <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
                        Your booking is confirmed.
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
};

export default GuestDashboard;
