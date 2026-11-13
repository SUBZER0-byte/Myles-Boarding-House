import { DashboardLayout } from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Bell, Trash2, Send, Loader2, Radio, AlertTriangle, XCircle, Check } from "lucide-react";
import { useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { useAdminNotifications } from "@/hooks/useAdminNotifications";
import {
  listNotificationRecipients,
  sendAdminNotification,
  type NotificationRecipient,
  type AdminNotification,
} from "@/lib/adminNotifications";
import {
  deleteUserNotification,
  markAllUserNotificationsRead,
  markUserNotificationRead,
} from "@/lib/userNotifications";

const AdminNotifications = () => {
  const { toast } = useToast();
  const { items, refetch, error, loading } = useAdminNotifications();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"send" | "broadcast">("send");
  const [recipients, setRecipients] = useState<NotificationRecipient[]>([]);
  const [recipientsError, setRecipientsError] = useState<string | null>(null);
  const [form, setForm] = useState({ user_id: "", user_type: "Tenant", title: "", message: "", type: "info" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    const loadRecipients = async () => {
      try {
        const users = await listNotificationRecipients();
        if (active) {
          setRecipients(users);
          setRecipientsError(null);
        }
      } catch (caught) {
        if (active) {
          setRecipientsError(caught instanceof Error ? caught.message : "Could not load active users.");
        }
      }
    };

    void loadRecipients();
    return () => {
      active = false;
    };
  }, []);

  const submit = async () => {
    setSaving(true);
    try {
      const message = mode === "send"
        ? await sendAdminNotification({
            user_id: Number(form.user_id),
            title: form.title,
            message: form.message,
            type: form.type,
          })
        : await sendAdminNotification({
            user_type: form.user_type,
            title: form.title,
            message: form.message,
            type: form.type,
          });
      toast({ title: message });
      setOpen(false);
      void refetch();
    } catch (caught) {
      toast({
        title: caught instanceof Error ? caught.message : "Could not send notification.",
        variant: "destructive",
      });
    } finally { setSaving(false); }
  };

  const runUserNotificationAction = async (action: () => Promise<void>) => {
    try {
      await action();
      void refetch();
    } catch (caught) {
      toast({
        title: caught instanceof Error ? caught.message : "Could not update notification.",
        variant: "destructive",
      });
    }
  };

  const remove = (notification: AdminNotification) =>
    runUserNotificationAction(() => deleteUserNotification(notification.notification_id));
  const markRead = (notification: AdminNotification) =>
    runUserNotificationAction(() => markUserNotificationRead(notification.notification_id));

  return (
    <DashboardLayout role="admin">
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="font-display text-2xl font-bold">Notifications</h1>
          </div>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() => void runUserNotificationAction(markAllUserNotificationsRead)}
              className="gap-2"
            >
              <Check size={14} /> Mark my notifications read
            </Button>
            <Button variant="secondary" onClick={() => { setMode("send"); setOpen(true); }} className="gap-2"><Send size={14} /> Send</Button>
            <Button onClick={() => { setMode("broadcast"); setOpen(true); }} className="gap-2"><Radio size={14} /> Broadcast</Button>
          </div>
        </div>
        {error && <div className="p-3 rounded-md border border-destructive/30 bg-destructive/10 text-destructive text-xs">{error.message}</div>}
        {loading && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 size={14} className="animate-spin" /> Loading…</div>}

        <div className="space-y-2">
          {items?.length === 0 && (
            <p className="text-sm text-muted-foreground">No notifications yet.</p>
          )}
          {items?.map((n) => {
            const isCancellation = n.type === "booking_cancellation";
            const isCancellationTenancy = n.type === "cancellation";
            return (
              <div
                key={n.notification_id}
                className={`bg-card border rounded-lg p-4 flex items-start gap-3 ${
                  isCancellation
                    ? "border-orange-400/60 bg-orange-500/5"
                    : !n.is_read
                    ? "border-primary/40"
                    : "border-border"
                }`}
              >
                {isCancellation ? (
                  <AlertTriangle size={16} className="text-orange-500 mt-1 shrink-0" />
                ) : isCancellationTenancy ? (
                  <XCircle size={16} className="text-destructive mt-1 shrink-0" />
                ) : (
                  <Bell size={16} className="text-primary mt-1 shrink-0" />
                )}
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className={`font-medium text-sm ${isCancellation ? "text-orange-600 dark:text-orange-400" : ""}`}>
                      {n.title}
                    </p>
                    <Badge
                      variant="secondary"
                      className={`text-xs ${
                        isCancellation
                          ? "bg-orange-500/15 text-orange-600 border-orange-400/30 dark:text-orange-400"
                          : ""
                      }`}
                    >
                      {n.type}
                    </Badge>
                    <Badge variant={n.is_read ? "secondary" : "default"} className="text-xs">
                      {n.is_read ? "Read" : "Unread"}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">{n.message}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    to {n.username ?? `#${n.user_id}`} · {new Date(n.created_at).toLocaleString()}
                  </p>
                </div>
                {!n.is_read && (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 shrink-0"
                    aria-label="Mark notification as read"
                    onClick={() => void markRead(n)}
                  >
                    <Check size={14} />
                  </Button>
                )}
                <button
                  className="h-8 w-8 flex items-center justify-center rounded-md text-destructive hover:bg-destructive/10 transition-colors shrink-0"
                  onClick={() => void remove(n)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{mode === "send" ? "Send Notification" : "Broadcast"}</DialogTitle>
            <DialogDescription>{mode === "send" ? "To a specific user." : "To all users of a type."}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {mode === "send" ? (
              <div className="grid gap-1.5"><Label>Recipient</Label>
                <Select value={form.user_id} onValueChange={v => setForm({ ...form, user_id: v })}>
                  <SelectTrigger><SelectValue placeholder={recipientsError ? "Could not load users" : recipients.length ? "Choose recipient" : "Loading users..."} /></SelectTrigger>
                  <SelectContent>
                    {recipients.length === 0 ? (
                      <div className="px-2 py-2 text-sm text-muted-foreground">{recipientsError || "No active users available."}</div>
                    ) : recipients.map((user) => (
                      <SelectItem key={user.user_id} value={String(user.user_id)}>
                        {user.full_name || user.username || `User #${user.user_id}`} ({user.user_type || "User"})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select></div>
            ) : (
              <div className="grid gap-1.5"><Label>Audience</Label>
                <Select value={form.user_type} onValueChange={v => setForm({ ...form, user_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Tenant">All Tenants</SelectItem>
                    <SelectItem value="Admin">All Admins</SelectItem>
                    <SelectItem value="Guest">All Guests</SelectItem>
                  </SelectContent>
                </Select></div>
            )}
            <div className="grid gap-1.5"><Label>Title</Label>
              <Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></div>
            <div className="grid gap-1.5"><Label>Message</Label>
              <Textarea rows={4} value={form.message} onChange={e => setForm({ ...form, message: e.target.value })} /></div>
            <div className="grid gap-1.5"><Label>Type</Label>
              <Select value={form.type} onValueChange={v => setForm({ ...form, type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="info">Info</SelectItem>
                  <SelectItem value="warning">Warning</SelectItem>
                  <SelectItem value="success">Success</SelectItem>
                </SelectContent>
              </Select></div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={submit} disabled={saving}>{saving ? "Sending…" : "Send"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
};

export default AdminNotifications;
