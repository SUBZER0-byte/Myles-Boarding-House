import { DashboardLayout } from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Plus, Pencil, Trash2, Megaphone, Loader2 } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { usePolling } from "@/hooks/usePolling";
import { api, endpoints, sessionStore, type ApiResponse } from "@/lib/api";

interface Announcement {
  announcement_id: number;
  title: string;
  body: string;
  is_published: number;
  created_at: string;
}

const AdminAnnouncements = () => {
  const { toast } = useToast();
  const session = sessionStore.get();
  const { data: items, refetch, error } = usePolling<Announcement[]>(`${endpoints.adminAnnouncements}?action=list`, { intervalMs: 5000 });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Announcement | null>(null);
  const [form, setForm] = useState({ title: "", body: "", is_published: 1 });
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selectedAnnouncement, setSelectedAnnouncement] = useState<Announcement | null>(null);
  const [confirmText, setConfirmText] = useState("");

  const openAdd = () => { setEditing(null); setForm({ title: "", body: "", is_published: 1 }); setOpen(true); };
  const openEdit = (a: Announcement) => {
    setEditing(a); setForm({ title: a.title, body: a.body, is_published: a.is_published });
    setOpen(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const url = editing
        ? `${endpoints.adminAnnouncements}?action=update`
        : `${endpoints.adminAnnouncements}?action=create`;
      const body = editing
        ? { ...form, announcement_id: editing.announcement_id }
        : { ...form, author_id: session?.user_id ?? 0 };
      const res = await api.post<ApiResponse>(url, body);
      if (res.data.type === "success") { toast({ title: editing ? "Updated" : "Created" }); setOpen(false); refetch(); }
      else toast({ title: res.data.message || "Failed", variant: "destructive" });
    } finally { setSaving(false); }
  };

  const togglePublish = async (a: Announcement) => {
    await api.get(`${endpoints.adminAnnouncements}?action=publish&announcement_id=${a.announcement_id}&is_published=${a.is_published ? 0 : 1}`);
    refetch();
  };

  const openDelete = (a: Announcement) => {
    setSelectedAnnouncement(a);
    setConfirmText("");
    setDeleteOpen(true);
  };

  const remove = async () => {
    if (!selectedAnnouncement) return;
    const res = await api.get<ApiResponse>(`${endpoints.adminAnnouncements}?action=delete&announcement_id=${selectedAnnouncement.announcement_id}`);
    setDeleteOpen(false);
    setSelectedAnnouncement(null);
    setConfirmText("");
    toast({ title: res.data.message || "Deleted" });
    refetch();
  };

  return (
    <DashboardLayout role="admin">
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="font-display text-2xl font-bold">Announcements</h1>
            <p className="text-muted-foreground text-sm mt-1">Create and publish updates for tenants and guests.</p>
          </div>
          <Button onClick={openAdd} className="gap-2"><Plus size={16} /> New</Button>
        </div>
        {error && <div className="p-3 rounded-md border border-destructive/30 bg-destructive/10 text-destructive text-xs">{error}</div>}
        {!items && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 size={14} className="animate-spin" /> Loading…</div>}

        <div className="space-y-3">
          {items?.map((a) => (
            <div key={a.announcement_id} className="bg-card border border-border rounded-lg p-5">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex items-center gap-2">
                  <Megaphone size={16} className="text-primary" />
                  <h3 className="font-medium">{a.title}</h3>
                  <Badge variant={a.is_published ? "default" : "secondary"} className="text-xs">
                    {a.is_published ? "Published" : "Draft"}
                  </Badge>
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => togglePublish(a)}>
                    {a.is_published ? "Unpublish" : "Publish"}
                  </Button>
                  <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openEdit(a)}><Pencil size={14} /></Button>
                  <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => openDelete(a)}><Trash2 size={14} /></Button>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">{a.body}</p>
              <p className="text-xs text-muted-foreground mt-2">{new Date(a.created_at).toLocaleString()}</p>
            </div>
          ))}
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? "Edit" : "New"} Announcement</DialogTitle><DialogDescription>Visible to tenants.</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-1.5"><Label>Title</Label>
              <Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></div>
            <div className="grid gap-1.5"><Label>Body</Label>
              <Textarea rows={5} value={form.body} onChange={e => setForm({ ...form, body: e.target.value })} /></div>
            <div className="flex items-center justify-between p-3 rounded-md bg-muted/50">
              <Label className="text-sm">Publish immediately</Label>
              <Switch checked={!!form.is_published} onCheckedChange={(v) => setForm({ ...form, is_published: v ? 1 : 0 })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Announcement?</AlertDialogTitle>
            <AlertDialogDescription>
              To confirm deletion, type the announcement title exactly as shown below.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3 pt-2">
            <p className="text-sm text-muted-foreground">Title: <span className="font-semibold">{selectedAnnouncement?.title}</span></p>
            <Input
              placeholder="Type announcement title to confirm"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setSelectedAnnouncement(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={confirmText !== selectedAnnouncement?.title} onClick={remove}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
};

export default AdminAnnouncements;
