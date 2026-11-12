import { DashboardLayout } from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Wrench, Trash2, Loader2 } from "lucide-react";
import { usePolling } from "@/hooks/usePolling";
import { api, API_BASE_URL, endpoints, type ApiResponse } from "@/lib/api";

interface Request {
  request_id: number;
  full_name: string;
  room_number: string | null;
  title: string;
  category: string;
  description: string;
  priority: string;
  status: string;
  photo_path: string | null;
  created_at: string;
  status_history?: { status: string; changed_at: string; changed_by_name: string | null }[];
}

const AdminMaintenance = () => {
  const { data: items, refetch, error } = usePolling<Request[]>(`${endpoints.adminMaintenance}?action=list`, { intervalMs: 5000 });
  const displayStatus = (status: string) => ({ Pending: "Submitted", Ongoing: "In Progress", Completed: "Resolved" }[status] ?? status);

  const setStatus = async (r: Request, status: string) => {
    await api.post<ApiResponse>(`${endpoints.adminMaintenance}?action=update_status`, { request_id: r.request_id, status });
    refetch();
  };
  const remove = async (r: Request) => {
    await api.get<ApiResponse>(`${endpoints.adminMaintenance}?action=delete&request_id=${r.request_id}`);
    refetch();
  };

  const variant = (s: string): "default" | "secondary" | "destructive" =>
    s === "Completed" ? "default" : s === "Pending" ? "destructive" : "secondary";

  return (
    <DashboardLayout role="admin">
      <div className="space-y-6">
        <div>
          <h1 className="font-display text-2xl font-bold">Maintenance</h1>
          <p className="text-muted-foreground text-sm mt-1">Review maintenance requests and manage their progress and resolution.</p>
        </div>
        {error && <div className="p-3 rounded-md border border-destructive/30 bg-destructive/10 text-destructive text-xs">{error}</div>}
        {!items && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 size={14} className="animate-spin" /> Loading…</div>}

        <div className="space-y-3">
          {items?.map((r) => (
            <div key={r.request_id} className="bg-card border border-border rounded-lg p-5">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex items-start gap-3">
                  <Wrench size={16} className="text-primary mt-1" />
                  <div>
                    <p className="font-medium text-sm">{r.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {r.full_name} · Room {r.room_number ?? "—"} · {r.category} · {new Date(r.created_at).toLocaleString()}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-xs">{r.priority}</Badge>
                  <Badge variant={variant(r.status)} className="text-xs">{displayStatus(r.status)}</Badge>
                </div>
              </div>
              <p className="text-sm text-muted-foreground mb-3">{r.description}</p>
              {r.photo_path && <img src={`${API_BASE_URL}/Tenant/request_photo.php?type=maintenance&id=${r.request_id}`} alt="Maintenance request attachment" className="mb-3 max-h-72 max-w-full rounded-md border border-border object-contain" />}
              {r.status_history && r.status_history.length > 0 && (
                <div className="mb-3 border-l-2 border-border pl-3 space-y-1.5">
                  {r.status_history.map((entry, index) => (
                    <p key={`${entry.status}-${entry.changed_at}-${index}`} className="text-xs">
                      <span className="font-medium">{displayStatus(entry.status)}</span>
                      <span className="text-muted-foreground"> · {new Date(entry.changed_at).toLocaleString()}{entry.changed_by_name ? ` · ${entry.changed_by_name}` : ""}</span>
                    </p>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-2 flex-wrap">
                <Select value={r.status === "Ongoing" ? "In Progress" : displayStatus(r.status)} onValueChange={(v) => setStatus(r, v)}>
                  <SelectTrigger className="h-8 w-40 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Submitted">Submitted</SelectItem>
                    <SelectItem value="Acknowledged">Acknowledged</SelectItem>
                    <SelectItem value="In Progress">In Progress</SelectItem>
                    <SelectItem value="Resolved">Resolved</SelectItem>
                    <SelectItem value="Cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
                <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive ml-auto" onClick={() => remove(r)}><Trash2 size={14} /></Button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
};

export default AdminMaintenance;
