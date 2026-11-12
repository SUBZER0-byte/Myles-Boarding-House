import { DashboardLayout } from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Trash2, MessageSquareWarning, Loader2, Send, AlertTriangle } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { usePolling } from "@/hooks/usePolling";
import { api, API_BASE_URL, endpoints, type ApiResponse } from "@/lib/api";

interface Complaint {
  complaint_id: number;
  tenant_id: number;
  full_name: string;
  title: string;
  description: string;
  status: string;
  category: string;
  room_number: string | null;
  is_urgent: number;
  photo_path: string | null;
  admin_reply: string | null;
  created_at: string;
  status_history?: { status: string; changed_at: string; changed_by_name: string | null }[];
}

interface RecurringIssue {
  category: string;
  room_number: string;
  complaint_count: number | string;
  latest_report: string;
}

const AdminComplaints = () => {
  const { toast } = useToast();
  const [filter, setFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [roomFilter, setRoomFilter] = useState("all");
  const { data: items, refetch, error } = usePolling<Complaint[]>(`${endpoints.adminComplaints}?action=list`, { intervalMs: 5000 });
  const { data: recurringIssues } = usePolling<RecurringIssue[]>(`${endpoints.adminComplaints}?action=report`, { intervalMs: 30000 });
  const [replyOpen, setReplyOpen] = useState(false);
  const [selected, setSelected] = useState<Complaint | null>(null);
  const [reply, setReply] = useState("");

  const setStatus = async (c: Complaint, status: string) => {
    await api.post<ApiResponse>(`${endpoints.adminComplaints}?action=update_status`, { complaint_id: c.complaint_id, status });
    refetch();
  };

  const sendReply = async () => {
    if (!selected) return;
    const res = await api.post<ApiResponse>(`${endpoints.adminComplaints}?action=reply`, { complaint_id: selected.complaint_id, reply });
    toast({ title: res.data.message || "Sent" });
    setReplyOpen(false); setReply(""); refetch();
  };

  const remove = async (c: Complaint) => {
    await api.get<ApiResponse>(`${endpoints.adminComplaints}?action=delete&complaint_id=${c.complaint_id}`);
    refetch();
  };

  const variant = (s: string): "default" | "secondary" | "destructive" =>
    s === "Resolved" ? "default" : s === "Submitted" ? "destructive" : "secondary";
  const categories = [...new Set((items ?? []).map(item => item.category || "Other"))].sort();
  const rooms = [...new Set((items ?? []).map(item => item.room_number ?? "Unassigned"))].sort();
  const filteredItems = (items ?? []).filter(item =>
    (filter === "all" || item.status === filter) &&
    (categoryFilter === "all" || (item.category || "Other") === categoryFilter) &&
    (roomFilter === "all" || (item.room_number ?? "Unassigned") === roomFilter)
  );

  return (
    <DashboardLayout role="admin">
      <div className="space-y-6">
        <div>
          <h1 className="font-display text-2xl font-bold">Complaints</h1>
          <p className="text-muted-foreground text-sm mt-1">Review tenant complaints, respond, and track their resolution.</p>
        </div>
        {error && <div className="p-3 rounded-md border border-destructive/30 bg-destructive/10 text-destructive text-xs">{error}</div>}

        <div className="flex gap-2 flex-wrap">
          {["all","Submitted","Acknowledged","In Progress","Resolved"].map(s => (
            <Button key={s} size="sm" variant={filter === s ? "default" : "secondary"} onClick={() => setFilter(s)}>{s === "all" ? "All" : s}</Button>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label>Filter by category</Label>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {categories.map(category => <SelectItem key={category} value={category}>{category}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Filter by room</Label>
            <Select value={roomFilter} onValueChange={setRoomFilter}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All rooms</SelectItem>
                {rooms.map(room => <SelectItem key={room} value={room}>{room}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <section className="space-y-3 border-t border-border pt-5">
          <div>
            <h2 className="font-semibold">Recurring issues</h2>
            <p className="text-xs text-muted-foreground">Categories reported more than once for the same room.</p>
          </div>
          {!recurringIssues && <p className="text-sm text-muted-foreground">Loading report…</p>}
          {recurringIssues?.length === 0 && <p className="text-sm text-muted-foreground">No recurring issues found.</p>}
          {recurringIssues && recurringIssues.length > 0 && (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {recurringIssues.map(issue => (
                <div key={`${issue.room_number}-${issue.category}`} className="border border-border rounded-md p-3">
                  <p className="font-medium text-sm">Room {issue.room_number} · {issue.category}</p>
                  <p className="text-xs text-muted-foreground">{issue.complaint_count} reports · Latest {new Date(issue.latest_report).toLocaleDateString()}</p>
                </div>
              ))}
            </div>
          )}
        </section>

        {!items && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 size={14} className="animate-spin" /> Loading…</div>}
        <div className="space-y-3">
          {filteredItems.map((c) => (
            <div key={c.complaint_id} className="bg-card border border-border rounded-lg p-5">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex items-start gap-3">
                  <MessageSquareWarning size={16} className="text-primary mt-1" />
                  <div>
                    <p className="font-medium text-sm">{c.title}</p>
                    <p className="text-xs text-muted-foreground">{c.full_name} · Room {c.room_number ?? "—"} · {c.category || "Other"} · {new Date(c.created_at).toLocaleString()}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  {c.is_urgent === 1 && <Badge variant="destructive" className="text-xs gap-1"><AlertTriangle size={12} /> Urgent</Badge>}
                  <Badge variant={variant(c.status)} className="text-xs">{c.status}</Badge>
                </div>
              </div>
              <p className="text-sm text-muted-foreground mb-3">{c.description}</p>
              {c.photo_path && <img src={`${API_BASE_URL}/Tenant/request_photo.php?type=complaint&id=${c.complaint_id}`} alt="Complaint attachment" className="mb-3 max-h-72 max-w-full rounded-md border border-border object-contain" />}
              {c.status_history && c.status_history.length > 0 && (
                <div className="mb-3 border-l-2 border-border pl-3 space-y-1.5">
                  {c.status_history.map((entry, index) => (
                    <p key={`${entry.status}-${entry.changed_at}-${index}`} className="text-xs">
                      <span className="font-medium">{entry.status}</span>
                      <span className="text-muted-foreground"> · {new Date(entry.changed_at).toLocaleString()}{entry.changed_by_name ? ` · ${entry.changed_by_name}` : ""}</span>
                    </p>
                  ))}
                </div>
              )}
              {c.admin_reply && (
                <div className="p-3 rounded-md bg-primary/5 border border-primary/20 text-xs mb-3">
                  <p className="font-medium text-primary mb-1">Admin reply:</p>
                  <p>{c.admin_reply}</p>
                </div>
              )}
              <div className="flex items-center gap-2 flex-wrap">
                <Select value={c.status} onValueChange={(v) => setStatus(c, v)}>
                  <SelectTrigger className="h-8 w-40 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Submitted">Submitted</SelectItem>
                    <SelectItem value="Acknowledged">Acknowledged</SelectItem>
                    <SelectItem value="In Progress">In Progress</SelectItem>
                    <SelectItem value="Resolved">Resolved</SelectItem>
                    <SelectItem value="Cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
                <Button size="sm" variant="secondary" className="gap-1" onClick={() => { setSelected(c); setReply(c.admin_reply ?? ""); setReplyOpen(true); }}>
                  <Send size={12} /> Reply
                </Button>
                <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive ml-auto" onClick={() => remove(c)}><Trash2 size={14} /></Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <Dialog open={replyOpen} onOpenChange={setReplyOpen}>
        <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Reply to {selected?.full_name}</DialogTitle><DialogDescription>Re: {selected?.title}</DialogDescription></DialogHeader>
          <Textarea rows={5} value={reply} onChange={e => setReply(e.target.value)} placeholder="Type your response…" />
          <DialogFooter>
            <Button variant="secondary" onClick={() => setReplyOpen(false)}>Cancel</Button>
            <Button onClick={sendReply}>Send Reply</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
};

export default AdminComplaints;
