import { useState, useEffect, useRef } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { sessionStore } from "@/lib/api";
import { signOutSupabase } from "@/lib/auth";
import { usePolling } from "@/hooks/usePolling";
import { useUserUnreadNotificationCount } from "@/hooks/useUserNotifications";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import logo from "@/assets/logo.png";
import {
  LayoutDashboard, Users, BedDouble, Megaphone, MessageSquareWarning, Wrench,
  CreditCard, Bell, Settings, LogOut, ChevronLeft, ChevronRight, X, Star, BarChart3, MessageCircle, UserRound, Heart, MapPin, ScrollText, XCircle, ReceiptText, Wallet, Sun, Moon
} from "lucide-react";

interface NavItem {
  label: string;
  to: string;
  icon: React.ElementType;
}

const adminNav: NavItem[] = [
  { label: "Dashboard", to: "/admin", icon: LayoutDashboard },
  { label: "Analytics", to: "/admin/analytics", icon: BarChart3 },
  { label: "Tenants", to: "/admin/tenants", icon: Users },
  { label: "Guests", to: "/admin/guests", icon: UserRound },
  { label: "Rooms", to: "/admin/rooms", icon: BedDouble },
  { label: "Announcements", to: "/admin/announcements", icon: Megaphone },
  { label: "Complaints", to: "/admin/complaints", icon: MessageSquareWarning },
  { label: "Maintenance", to: "/admin/maintenance", icon: Wrench },
  { label: "Rent Payments", to: "/admin/payments", icon: CreditCard },
  { label: "Booking Payments", to: "/admin/booking-payments", icon: CreditCard },
  { label: "Refunds", to: "/admin/refunds", icon: Wallet },
  { label: "Full Payment Requests", to: "/admin/full-payments", icon: Wallet },
  { label: "Cancellations", to: "/admin/cancellations", icon: XCircle },
  { label: "Ratings", to: "/admin/ratings", icon: Star },
  { label: "Messages", to: "/admin/messages", icon: MessageCircle },
  { label: "Notifications", to: "/admin/notifications", icon: Bell },
  { label: "Log History", to: "/admin/logs", icon: ScrollText },
  { label: "Settings", to: "/admin/settings", icon: Settings },
];

const tenantNav: NavItem[] = [
  { label: "Dashboard", to: "/tenant", icon: LayoutDashboard },
  { label: "My Room", to: "/tenant/room", icon: BedDouble },
  { label: "Payments", to: "/tenant/payments", icon: CreditCard },
  { label: "Cancellation", to: "/tenant/cancellation", icon: XCircle },
  { label: "Announcements", to: "/tenant/announcements", icon: Megaphone },
  { label: "Complaints", to: "/tenant/complaints", icon: MessageSquareWarning },
  { label: "Maintenance", to: "/tenant/maintenance", icon: Wrench },
  { label: "Ratings", to: "/tenant/ratings", icon: Star },
  { label: "Messages", to: "/tenant/messages", icon: MessageCircle },
  { label: "Notifications", to: "/tenant/notifications", icon: Bell },
  { label: "Settings", to: "/tenant/settings", icon: Settings },
];

const guestNav: NavItem[] = [
  { label: "Dashboard", to: "/guest", icon: LayoutDashboard },
  { label: "Browse Rooms", to: "/guest/rooms", icon: BedDouble },
  { label: "My Booking", to: "/guest/booking", icon: ReceiptText },
  { label: "Location", to: "/guest/location", icon: MapPin },
  { label: "Saved", to: "/guest/saved", icon: Heart },
  { label: "Messages", to: "/guest/messages", icon: MessageCircle },
  { label: "Notifications", to: "/guest/notifications", icon: Bell },
  { label: "Settings", to: "/guest/settings", icon: Settings },
];

interface SidebarProps {
  role: "admin" | "tenant" | "guest";
  collapsed: boolean;
  onToggle: () => void;
  mobileOpen: boolean;
  onMobileClose: () => void;
}

export function DashboardSidebar({ role, collapsed, onToggle, mobileOpen, onMobileClose }: SidebarProps) {
  const [visible, setVisible] = useState(false);
  const [animating, setAnimating] = useState(false);
  const { theme, setTheme } = useTheme();
  const isDark = theme === "dark";
  const location = useLocation();
  const navigate = useNavigate();
  const nav = role === "admin" ? adminNav : role === "tenant" ? tenantNav : guestNav;
  const navRef = useRef<HTMLElement | null>(null);
  const scrollKey = `sidebarScroll:${role}`;
  const userId = Number((sessionStore.get() as { user_id?: number | string } | null)?.user_id ?? 0);
  const { count: unreadNotifications } = useUserUnreadNotificationCount(10000);
  const { data: unreadMessages } = usePolling<{ count: number }>(
    userId > 0 ? `/Chat/messages.php?action=unread_count&user_id=${userId}` : null,
    { alwaysPoll: true, intervalMs: 10000 },
  );

  // Restore scroll position on mount (after route change re-mounts layout)
  useEffect(() => {
    const saved = sessionStorage.getItem(scrollKey);
    if (navRef.current && saved) {
      navRef.current.scrollTop = Number(saved) || 0;
    }
  }, [scrollKey]);

  const handleNavScroll = () => {
    if (navRef.current) {
      sessionStorage.setItem(scrollKey, String(navRef.current.scrollTop));
    }
  };

  const isNavActive = (itemTo: string) => {
    const currentPath = location.pathname.replace(/\/+$/, "") || "/";

    if (itemTo === "/") return currentPath === "/";

    if (itemTo === "/admin" || itemTo === "/tenant" || itemTo === "/guest") {
      return currentPath === itemTo;
    }

    return currentPath === itemTo || currentPath.startsWith(`${itemTo}/`);
  };

  // Handle open/close with animation
  useEffect(() => {
    if (mobileOpen) {
      setVisible(true);
      // Wait one frame so the element mounts in its closed state,
      // then animate to open for a proper slide-in transition.
      const raf = requestAnimationFrame(() => setAnimating(true));
      return () => cancelAnimationFrame(raf);
    } else if (visible) {
      setAnimating(false);
      const timer = setTimeout(() => setVisible(false), 700);
      return () => clearTimeout(timer);
    }
  }, [mobileOpen]);

  const handleLogout = async () => {
    try {
      await signOutSupabase();
      onMobileClose();
      navigate("/login", { replace: true });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not sign out.");
    }
  };

  const sidebarContent = (
    <>
      <div className={`border-b border-sidebar-border ${collapsed ? "flex flex-col items-center gap-1 p-2" : "flex items-center justify-between p-4"}`}>
        <div className={`flex min-w-0 items-center gap-2 ${collapsed ? "justify-center" : "flex-1"}`}>
          <img src={logo} alt="" aria-hidden="true" className="h-8 w-8 shrink-0 object-contain" />
          {!collapsed && (
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="font-display font-bold text-sm text-sidebar-primary leading-tight">Myle's Boarding House</span>
              {role === "admin" && <span className="text-xs text-sidebar-foreground/60 font-medium">Admin Panel</span>}
              {role === "tenant" && <span className="text-xs text-sidebar-foreground/60 font-medium">Tenant Panel</span>}
              {role === "guest" && <span className="text-xs text-sidebar-foreground/60 font-medium">Guest Panel</span>}
            </div>
          )}
        </div>
        {/* Desktop: collapse toggle, Mobile: close button */}
        <button onClick={onToggle} className={`hidden md:block p-1.5 rounded-md hover:bg-sidebar-accent transition-colors ${collapsed ? "self-center" : "shrink-0"}`}>
          {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </button>
        <button onClick={onMobileClose} className="md:hidden p-1.5 rounded-md hover:bg-sidebar-accent transition-colors">
          <X size={18} />
        </button>
      </div>
      <nav
        ref={navRef}
        onScroll={handleNavScroll}
        className="flex-1 p-2 space-y-1 overflow-y-auto"
      >
        {nav.map((item) => {
          const isActive = isNavActive(item.to);
          const unreadCount = item.label === "Messages"
            ? Number(unreadMessages?.count ?? 0)
            : item.label === "Notifications"
              ? unreadNotifications
              : 0;
          return (
            <Link
              key={item.to}
              to={item.to}
              onClick={onMobileClose}
              aria-label={`${item.label}${unreadCount > 0 ? `, ${unreadCount} unread` : ""}`}
              className={`flex items-center ${collapsed ? "justify-center px-0" : "gap-3 px-3"} py-2.5 rounded-md text-sm transition-colors ${
                isActive
                  ? "bg-sidebar-primary text-sidebar-primary-foreground"
                  : "hover:bg-sidebar-accent text-sidebar-foreground"
              }`}
            >
              <span className="relative inline-flex shrink-0">
                <item.icon size={collapsed ? 22 : 18} />
                {unreadCount > 0 && (
                  <span
                    aria-hidden="true"
                    className="absolute -right-2 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full border border-sidebar bg-destructive px-1 text-[10px] font-semibold leading-none text-destructive-foreground"
                  >
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
              </span>
              {!collapsed && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-sidebar-border p-2">
        {collapsed ? (
          <button
            type="button"
            onClick={() => setTheme(isDark ? "light" : "dark")}
            aria-label={`Switch to ${isDark ? "light" : "dark"} mode`}
            title={`Switch to ${isDark ? "light" : "dark"} mode`}
            className="flex w-full justify-center rounded-md p-2.5 text-sidebar-foreground transition-colors hover:bg-sidebar-accent"
          >
            {isDark ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        ) : (
          <div className="flex items-center justify-between gap-3 px-3 py-2">
            <span className="text-sm text-sidebar-foreground">Appearance</span>
            <div className="flex items-center gap-2">
              <Sun size={16} className={!isDark ? "text-sidebar-primary" : "text-sidebar-foreground/60"} aria-hidden="true" />
              <Switch
                checked={isDark}
                onCheckedChange={(checked) => setTheme(checked ? "dark" : "light")}
                aria-label="Toggle dark mode"
              />
              <Moon size={16} className={isDark ? "text-sidebar-primary" : "text-sidebar-foreground/60"} aria-hidden="true" />
            </div>
          </div>
        )}
      </div>
      <div className="p-2 border-t border-sidebar-border space-y-1">
        <button
          type="button"
          onClick={handleLogout}
          className={`w-full flex items-center ${collapsed ? "justify-center px-0" : "gap-3 px-3"} py-2.5 rounded-md text-sm hover:bg-sidebar-accent text-destructive transition-colors`}
        >
          <LogOut size={collapsed ? 22 : 18} />
          {!collapsed && <span>Logout</span>}
        </button>
      </div>
    </>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside className={`${collapsed ? "w-16" : "w-60"} hidden md:flex fixed top-0 left-0 h-screen bg-sidebar text-sidebar-foreground border-r border-sidebar-border flex-col transition-all duration-300 z-30`}>
        {sidebarContent}
      </aside>

      {/* Mobile overlay */}
      {visible && (
        <div className="md:hidden fixed inset-0 z-40">
          <div
            className={`absolute inset-0 bg-foreground/60 backdrop-blur-sm transition-opacity duration-[700ms] ease-[cubic-bezier(0.32,0.72,0,1)] ${animating ? "opacity-100" : "opacity-0"}`}
            onClick={onMobileClose}
          />
          <aside
            style={{ willChange: "transform", transitionDelay: animating ? "60ms" : "0ms" }}
            className={`relative w-64 h-full bg-sidebar text-sidebar-foreground border-r border-sidebar-border flex flex-col z-50 shadow-2xl transform-gpu transition-transform duration-[700ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${animating ? "translate-x-0" : "-translate-x-full"}`}
          >
            {sidebarContent}
          </aside>
        </div>
      )}
    </>
  );
}
