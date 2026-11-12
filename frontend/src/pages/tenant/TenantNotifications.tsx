import { DashboardLayout } from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Bell, Check, Trash2, Loader2 } from "lucide-react";
import { usePolling } from "@/hooks/usePolling";
import { api, endpoints, sessionStore, type ApiResponse } from "@/lib/api";

interface Notif { notification_id: number; title: string; message: string; type: string; is_read: number; created_at: string; }

const TenantNotifications = () => {
  const session = sessionStore.get();
  const userId = session?.user_id;
  const { data, refetch, error } = usePolling<Notif[]>(
    userId ? `${endpoints.tenantNotifications}?action=list&user_id=${userId}` : null,
    { intervalMs: 5000 }
  );

  const markRead = async (n: Notif) => {
    await api.get<ApiResponse>(`${endpoints.tenantNotifications}?action=mark_read&notification_id=${n.notification_id}`);
    refetch();
  };
  const markAll = async () => {
    if (!userId) return;
    await api.get<ApiResponse>(`${endpoints.tenantNotifications}?action=mark_all_read&user_id=${userId}`);
    refetch();
  };
  const remove = async (n: Notif) => {
    await api.get<ApiResponse>(`${endpoints.tenantNotifications}?action=delete&notification_id=${n.notification_id}`);
    refetch();
  };

  return (
    <DashboardLayout role="tenant">
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="font-display text-2xl font-bold">Notifications</h1>
          </div>
          <Button variant="secondary" size="sm" className="gap-1" onClick={markAll}><Check size={14} /> Mark all read</Button>
        </div>
        {!userId && <div className="p-3 rounded-md border border-warning/30 bg-warning/10 text-warning text-xs">Sign in to view notifications.</div>}
        {error && <div className="p-3 rounded-md border border-destructive/30 bg-destructive/10 text-destructive text-xs">{error}</div>}
        {userId && !data && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 size={14} className="animate-spin" /> Loading…</div>}
        {data?.length === 0 && <p className="text-sm text-muted-foreground">No notifications.</p>}

        <div className="space-y-2">
          {data?.map(n => (
            <div key={n.notification_id} className={`flex items-start gap-3 p-4 rounded-lg border ${n.is_read ? "bg-card border-border" : "bg-primary/5 border-primary/20"}`}>
              <Bell size={16} className="text-primary mt-1" />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <p className="font-medium text-sm">{n.title}</p>
                  <Badge variant="secondary" className="text-xs">{n.type}</Badge>
                  <Badge variant={n.is_read ? "secondary" : "default"} className="text-xs">
                    {n.is_read ? "Read" : "Unread"}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground mt-1">{n.message}</p>
                <p className="text-xs text-muted-foreground mt-1">{new Date(n.created_at).toLocaleString()}</p>
              </div>
              {!n.is_read && (
                <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Mark notification as read" onClick={() => markRead(n)}><Check size={14} /></Button>
              )}
              <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => remove(n)}><Trash2 size={14} /></Button>
            </div>
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
};

export default TenantNotifications;
