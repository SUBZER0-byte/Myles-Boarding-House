import { ReactNode, useState } from "react";
import { DashboardSidebar } from "./DashboardSidebar";
import { ChatbotWidget } from "./ChatbotWidget";
import { RoomAvailabilityProvider } from "./RoomAvailabilityProvider";
import { Menu } from "lucide-react";
import logo from "@/assets/logo.png";
import type { RoomAvailabilityRange } from "@/lib/roomAvailabilityContext";

export function DashboardLayout({
  role,
  children,
  roomAvailabilityRange = null,
}: {
  role: "admin" | "tenant" | "guest";
  children: ReactNode;
  roomAvailabilityRange?: RoomAvailabilityRange | null;
}) {
  const [collapsed, setCollapsed] = useState(() => sessionStorage.getItem(`dashboardSidebarCollapsed:${role}`) === "true");
  const [mobileOpen, setMobileOpen] = useState(false);
  const toggleCollapsed = () => {
    setCollapsed(current => {
      const next = !current;
      sessionStorage.setItem(`dashboardSidebarCollapsed:${role}`, String(next));
      return next;
    });
  };

  return (
    <RoomAvailabilityProvider range={roomAvailabilityRange}>
      <div className="min-h-screen w-full">
        <DashboardSidebar
          role={role}
          collapsed={collapsed}
          onToggle={toggleCollapsed}
          mobileOpen={mobileOpen}
          onMobileClose={() => setMobileOpen(false)}
        />

        {/* Mobile top bar */}
        <div
          className="md:hidden fixed top-0 left-0 right-0 bg-sidebar border-b border-sidebar-border flex items-center px-4 z-30"
          style={{
            height: "calc(3.5rem + env(safe-area-inset-top))",
            paddingTop: "env(safe-area-inset-top)",
          }}
        >
          <button
            onClick={() => setMobileOpen(true)}
            className="flex h-9 w-14 shrink-0 items-center justify-center rounded-[999px] border border-sidebar-border bg-sidebar-accent/30 text-sidebar-foreground transition-colors hover:bg-sidebar-accent"
            aria-label="Open sidebar"
            title="Open sidebar"
          >
            <Menu size={20} />
          </button>
          <img src={logo} alt="" aria-hidden="true" className="ml-3 h-8 w-8 object-contain" />
          <span className="ml-2 min-w-0 truncate font-display font-bold text-sidebar-primary text-sm">Myle's Boarding House</span>
        </div>

        <main className={`${collapsed ? "md:ml-16" : "md:ml-60"} transition-all duration-300 min-h-screen pt-[calc(3.5rem+env(safe-area-inset-top))] md:pt-0`}>
          <div className="w-full min-w-0 p-3 pb-32 sm:p-4 md:p-6">{children}</div>
        </main>
        <ChatbotWidget />
      </div>
    </RoomAvailabilityProvider>
  );
}
