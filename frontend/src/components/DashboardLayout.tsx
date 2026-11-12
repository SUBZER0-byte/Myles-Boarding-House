import { ReactNode, useState } from "react";
import { DashboardSidebar } from "./DashboardSidebar";
import { ChatbotWidget } from "./ChatbotWidget";
import { Menu } from "lucide-react";
import logo from "@/assets/logo.png";

export function DashboardLayout({ role, children }: { role: "admin" | "tenant" | "guest"; children: ReactNode }) {
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
        <button onClick={() => setMobileOpen(true)} className="p-2 rounded-md hover:bg-sidebar-accent transition-colors text-sidebar-foreground">
          <Menu size={20} />
        </button>
        <img src={logo} alt="" aria-hidden="true" className="ml-3 h-8 w-8 object-contain" />
        <span className="ml-2 min-w-0 truncate font-display font-bold text-sidebar-primary text-sm">Myle's Boarding House</span>
      </div>

      <main className={`${collapsed ? "md:ml-16" : "md:ml-60"} transition-all duration-300 min-h-screen pt-[calc(3.5rem+env(safe-area-inset-top))] md:pt-0`}>
        <div className="w-full min-w-0 p-4 pb-32 md:p-6">{children}</div>
      </main>
      <ChatbotWidget />
    </div>
  );
}
