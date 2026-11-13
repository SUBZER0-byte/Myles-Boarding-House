import { DashboardLayout } from "@/components/DashboardLayout";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSupabasePolling } from "@/hooks/useSupabasePolling";
import { useToast } from "@/hooks/use-toast";
import { deleteAdminLog, listAdminLogs, type AdminLog } from "@/lib/adminLogs";
import { ScrollText, Loader2, ShieldAlert, Trash2 } from "lucide-react";
import { useCallback, useState } from "react";

const levelTone: Record<AdminLog["level"], string> = {
  info: "bg-primary/10 text-primary border-primary/30",
  warning: "bg-warning/15 text-warning border-warning/30",
  error: "bg-destructive/15 text-destructive border-destructive/30",
  security: "bg-destructive/15 text-destructive border-destructive/40",
};

const AdminLogs = () => {
  const { toast } = useToast();
  const [level, setLevel] = useState<string>("");
  const [category, setCategory] = useState<string>("");
  const [q, setQ] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selectedLog, setSelectedLog] = useState<AdminLog | null>(null);
  const loadLogs = useCallback(
    () => listAdminLogs({ limit: 300, level, category, query: q }),
    [category, level, q],
  );
  const { data: logs, error, refetch } = useSupabasePolling(loadLogs, 5000);

  const deleteLog = async () => {
    if (!selectedLog) return;
    try {
      const message = await deleteAdminLog(selectedLog.log_id);
      toast({ title: message });
      setDeleteOpen(false);
      setSelectedLog(null);
      refetch();
    } catch (cause) {
      toast({
        title: "Could not delete log entry",
        description: cause instanceof Error ? cause.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <DashboardLayout role="admin">
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="font-display text-2xl font-bold flex items-center gap-2">
              <ScrollText size={22} className="text-primary" /> Log History
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              System audit trail — sign-ins, sign-ups, bookings, and security events.
            </p>
          </div>
        </div>

        {error && (
          <div className="p-3 rounded-md border border-destructive/30 bg-destructive/10 text-destructive text-xs">
            Could not load Supabase log history: {error}
          </div>
        )}

        <div className="grid sm:grid-cols-3 gap-3">
          <Input placeholder="Search action or message…" value={q} onChange={(e) => setQ(e.target.value)} />
          <Select value={category || "all"} onValueChange={(v) => setCategory(v === "all" ? "" : v)}>
            <SelectTrigger><SelectValue placeholder="All categories" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              <SelectItem value="auth">Auth</SelectItem>
              <SelectItem value="booking">Booking</SelectItem>
              <SelectItem value="payment">Payment</SelectItem>
              <SelectItem value="general">General</SelectItem>
            </SelectContent>
          </Select>
          <Select value={level || "all"} onValueChange={(v) => setLevel(v === "all" ? "" : v)}>
            <SelectTrigger><SelectValue placeholder="All levels" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All levels</SelectItem>
              <SelectItem value="info">Info</SelectItem>
              <SelectItem value="warning">Warning</SelectItem>
              <SelectItem value="error">Error</SelectItem>
              <SelectItem value="security">Security</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="text-left px-4 py-3">When</th>
                  <th className="text-left px-4 py-3">Level</th>
                  <th className="text-left px-4 py-3">Category</th>
                  <th className="text-left px-4 py-3">Action</th>
                  <th className="text-left px-4 py-3">Actor</th>
                  <th className="text-left px-4 py-3">IP</th>
                  <th className="text-left px-4 py-3">Message</th>
                  <th className="text-left px-4 py-3">Manage</th>
                </tr>
              </thead>
              <tbody>
                {!logs && (
                  <tr><td colSpan={8} className="px-4 py-6 text-center text-xs text-muted-foreground">
                    <Loader2 size={14} className="inline animate-spin mr-1" /> Loading logs…
                  </td></tr>
                )}
                {logs && logs.length === 0 && (
                  <tr><td colSpan={8} className="px-4 py-10 text-center text-xs text-muted-foreground">No log entries match.</td></tr>
                )}
                {logs?.map((l) => (
                  <tr key={l.log_id} className="border-t border-border hover:bg-muted/30">
                    <td className="px-4 py-2 whitespace-nowrap text-xs text-muted-foreground">{new Date(l.created_at).toLocaleString()}</td>
                    <td className="px-4 py-2">
                      <Badge variant="outline" className={`text-[10px] uppercase ${levelTone[l.level]}`}>
                        {l.level === "security" && <ShieldAlert size={10} className="mr-1" />}
                        {l.level}
                      </Badge>
                    </td>
                    <td className="px-4 py-2 text-xs capitalize">{l.category}</td>
                    <td className="px-4 py-2 text-xs font-mono">{l.action}</td>
                    <td className="px-4 py-2 text-xs">{l.actor_username || (l.actor_id ? `#${l.actor_id}` : "—")}</td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">{l.ip_address || "—"}</td>
                    <td className="px-4 py-2 text-xs">{l.message || "—"}</td>
                    <td className="px-4 py-2 text-right">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-destructive"
                        onClick={() => {
                          setSelectedLog(l);
                          setDeleteOpen(true);
                        }}
                      >
                        <Trash2 size={16} />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <AlertDialog open={deleteOpen} onOpenChange={(open) => {
        if (!open) setSelectedLog(null);
        setDeleteOpen(open);
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Log Entry?</AlertDialogTitle>
            <AlertDialogDescription>
              Deleting a log entry cannot be undone. Are you sure you want to remove this history record?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setSelectedLog(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={deleteLog}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
};

export default AdminLogs;
