import { DashboardLayout } from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Wrench, X, Loader2 } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { usePolling } from "@/hooks/usePolling";
import { api, API_BASE_URL, endpoints, sessionStore, type ApiResponse } from "@/lib/api";

interface Request {
  request_id: number;
  title: string;
  category: string;
  description: string;
  priority: string;
  status: string;
  photo_path: string | null;
  created_at: string;
  status_history?: { status: string; changed_at: string; changed_by_name: string | null }[];
}

const TenantMaintenance = () => {
  const { toast } = useToast();
  const session = sessionStore.get();
  const userId = session?.user_id;
  const { data, refetch, error } = usePolling<Request[]>(
    userId ? `${endpoints.tenantMaintenance}?action=list&user_id=${userId}` : null,
    { intervalMs: 5000 }
  );
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: "", category: "Other", description: "", priority: "Medium" });
  const [photo, setPhoto] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!userId) return;
    setSaving(true);
    try {
      const formData = new FormData();
      formData.append("title", form.title);
      formData.append("category", form.category);
      formData.append("description", form.description);
      formData.append("priority", form.priority);
      if (photo) formData.append("photo", photo);
      const res = await api.post<ApiResponse>(`${endpoints.tenantMaintenance}?action=create`, formData, { headers: { "Content-Type": undefined } });
      if (res.data.type === "success") { toast({ title: "Request submitted" }); setOpen(false); setForm({ title: "", category: "Other", description: "", priority: "Medium" }); setPhoto(null); refetch(); }
      else toast({ title: res.data.message || "Failed", variant: "destructive" });
    } finally { setSaving(false); }
  };

  const cancel = async (r: Request) => {
    await api.get<ApiResponse>(`${endpoints.tenantMaintenance}?action=cancel&request_id=${r.request_id}`);
    refetch();
  };

  const variant = (s: string): "default" | "secondary" | "destructive" =>
    s === "Completed" ? "default" : s === "Pending" ? "destructive" : "secondary";
  const displayStatus = (status: string) => status === "Ongoing" ? "In Progress" : status;

  return (
    <DashboardLayout role="tenant">
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="font-display text-2xl font-bold">Maintenance</h1>
          </div>
          <Button onClick={() => setOpen(true)} className="gap-2"><Plus size={16} /> New Request</Button>
        </div>
        {!userId && <div className="p-3 rounded-md border border-warning/30 bg-warning/10 text-warning text-xs">Sign in to view your requests.</div>}
        {error && <div className="p-3 rounded-md border border-destructive/30 bg-destructive/10 text-destructive text-xs">{error}</div>}
        {userId && !data && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 size={14} className="animate-spin" /> Loading…</div>}
        {data?.length === 0 && <p className="text-sm text-muted-foreground">No requests yet.</p>}

        <div className="space-y-3">
          {data?.map((r) => (
            <div key={r.request_id} className="bg-card border border-border rounded-lg p-5">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex items-start gap-3">
                  <Wrench size={16} className="text-primary mt-1" />
                  <div>
                    <p className="font-medium text-sm">{r.title}</p>
                    <p className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString()}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-xs">{r.priority}</Badge>
                  <Badge variant={variant(r.status)} className="text-xs">{displayStatus(r.status)}</Badge>
                  {r.status === "Submitted" && (
                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => cancel(r)}><X size={14} /></Button>
                  )}
                </div>
              </div>
              <p className="text-xs text-muted-foreground mb-2">{r.category} · {r.priority}</p>
              <p className="text-sm text-muted-foreground">{r.description}</p>
              {r.photo_path && <img src={`${API_BASE_URL}/Tenant/request_photo.php?type=maintenance&id=${r.request_id}`} alt="Maintenance request attachment" className="mt-3 max-h-72 max-w-full rounded-md border border-border object-contain" />}
              {r.status_history && r.status_history.length > 0 && (
                <div className="mt-3 border-l-2 border-border pl-3 space-y-2">
                  {r.status_history.map((entry, index) => (
                    <div key={`${entry.status}-${entry.changed_at}-${index}`} className="text-xs">
                      <span className="font-medium">{displayStatus(entry.status)}</span>
                      <span className="text-muted-foreground"> · {new Date(entry.changed_at).toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>New Maintenance Request</DialogTitle><DialogDescription>Describe the issue.</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-1.5"><Label>Title</Label>
              <Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></div>
            <div className="grid gap-1.5"><Label>Category</Label>
              <Select value={form.category} onValueChange={value => setForm({ ...form, category: value })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Plumbing">Plumbing</SelectItem>
                  <SelectItem value="Electrical">Electrical</SelectItem>
                  <SelectItem value="Noise">Noise</SelectItem>
                  <SelectItem value="Security">Security</SelectItem>
                  <SelectItem value="Sanitation">Sanitation</SelectItem>
                  <SelectItem value="Internet">Internet</SelectItem>
                  <SelectItem value="Other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5"><Label>Priority</Label>
              <Select value={form.priority} onValueChange={v => setForm({ ...form, priority: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Low">Low</SelectItem>
                  <SelectItem value="Medium">Medium</SelectItem>
                  <SelectItem value="High">High</SelectItem>
                  <SelectItem value="Urgent">Urgent</SelectItem>
                </SelectContent>
              </Select></div>
            <div className="grid gap-1.5"><Label>Description</Label>
              <Textarea rows={5} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
            <div className="grid gap-1.5"><Label htmlFor="maintenance-photo">Photo (optional)</Label>
              <Input id="maintenance-photo" type="file" accept="image/jpeg,image/png,image/webp" onChange={e => {
                const file = e.target.files?.[0] ?? null;
                if (file && (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024)) {
                  toast({ title: "Choose a JPG, PNG, or WEBP photo up to 10MB", variant: "destructive" });
                  e.target.value = "";
                  return;
                }
                setPhoto(file);
              }} />
              <p className="text-xs text-muted-foreground">JPG, PNG, or WEBP up to 10MB.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={submit} disabled={saving}>{saving ? "Sending…" : "Submit"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
};

export default TenantMaintenance;
