import { DashboardLayout } from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Bell, Check, Loader2, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useUserNotifications } from "@/hooks/useUserNotifications";
import {
  deleteUserNotification,
  markAllUserNotificationsRead,
  markUserNotificationRead,
  type UserNotification,
} from "@/lib/userNotifications";

interface UserNotificationsPanelProps {
  role: "tenant" | "guest";
}

export function UserNotificationsPanel({ role }: UserNotificationsPanelProps) {
  const { toast } = useToast();
  const { notifications, refetch, error, loading } = useUserNotifications();

  const runAction = async (action: () => Promise<void>) => {
    try {
      await action();
      void refetch();
    } catch (caught) {
      toast({
        title: caught instanceof Error ? caught.message : "Could not update notifications.",
        variant: "destructive",
      });
    }
  };

  const markRead = (notification: UserNotification) =>
    runAction(() => markUserNotificationRead(notification.notification_id));
  const remove = (notification: UserNotification) =>
    runAction(() => deleteUserNotification(notification.notification_id));

  return (
    <DashboardLayout role={role}>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="font-display text-2xl font-bold">Notifications</h1>
          </div>
          <Button
            variant="secondary"
            size="sm"
            className="gap-1"
            onClick={() => void runAction(markAllUserNotificationsRead)}
          >
            <Check size={14} /> Mark all read
          </Button>
        </div>
        {error && (
          <div className="p-3 rounded-md border border-destructive/30 bg-destructive/10 text-destructive text-xs">
            {error.message}
          </div>
        )}
        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 size={14} className="animate-spin" /> Loading…
          </div>
        )}
        {!loading && !error && notifications?.length === 0 && (
          <p className="text-sm text-muted-foreground">No notifications.</p>
        )}

        <div className="space-y-2">
          {notifications?.map((notification) => (
            <div
              key={notification.notification_id}
              className={`flex items-start gap-3 p-4 rounded-lg border ${
                notification.is_read ? "bg-card border-border" : "bg-primary/5 border-primary/20"
              }`}
            >
              <Bell size={16} className="text-primary mt-1" />
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-medium text-sm">{notification.title}</p>
                  {notification.type && <Badge variant="secondary" className="text-xs">{notification.type}</Badge>}
                  <Badge variant={notification.is_read ? "secondary" : "default"} className="text-xs">
                    {notification.is_read ? "Read" : "Unread"}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground mt-1">{notification.message}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {new Date(notification.created_at).toLocaleString()}
                </p>
              </div>
              {!notification.is_read && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  aria-label="Mark notification as read"
                  onClick={() => void markRead(notification)}
                >
                  <Check size={14} />
                </Button>
              )}
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 text-destructive"
                aria-label="Delete notification"
                onClick={() => void remove(notification)}
              >
                <Trash2 size={14} />
              </Button>
            </div>
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
}
