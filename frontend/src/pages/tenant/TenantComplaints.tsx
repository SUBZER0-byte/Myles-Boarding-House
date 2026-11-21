import { DashboardLayout } from "@/components/DashboardLayout";
import { RequestAttachmentList } from "@/components/RequestAttachmentList";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, MessageSquareWarning, X, Loader2, AlertTriangle } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { formatPhilippineDateTime } from "@/lib/philippineTime";
import { sessionStore } from "@/lib/api";
import { useSupabasePolling } from "@/hooks/useSupabasePolling";
import {
  cancelTenantComplaint,
  ComplaintAttachmentSaveError,
  createTenantComplaint,
  listTenantComplaints,
} from "@/lib/tenantRequests";

const TenantComplaints = () => {
  const { toast } = useToast();
  const session = sessionStore.get();
  const userId = session?.user_id;
  const loadComplaints = useCallback(() => listTenantComplaints(), []);
  const { data, refetch, error } = useSupabasePolling(loadComplaints, 5000, Boolean(userId));
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", category: "Other", is_urgent: false });
  const [photos, setPhotos] = useState<File[]>([]);
  const [video, setVideo] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const photosInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  const clearAttachments = () => {
    setPhotos([]);
    setVideo(null);
    if (photosInputRef.current) photosInputRef.current.value = "";
    if (videoInputRef.current) videoInputRef.current.value = "";
  };

  const submit = async () => {
    if (!userId) return;
    setSaving(true);
    try {
      const attachments = [
        ...photos.map(file => ({ file, type: "image" as const })),
        ...(video ? [{ file: video, type: "video" as const }] : []),
      ];
      const result = await createTenantComplaint(form, attachments);
      const smsFailures = Number(result.sms_failures ?? 0);
      toast({
        title: form.is_urgent && smsFailures > 0 ? "Complaint filed; SMS alert could not be confirmed" : "Complaint filed",
        description: form.is_urgent ? "If there is immediate danger, contact local emergency services. This alert does not replace them." : undefined,
        variant: form.is_urgent && smsFailures > 0 ? "destructive" : "default",
      });
      setOpen(false);
      setForm({ title: "", description: "", category: "Other", is_urgent: false });
      clearAttachments();
      await refetch();
    } catch (error) {
      const complaintFiled = error instanceof ComplaintAttachmentSaveError;
      toast({
        title: complaintFiled ? "Complaint filed, but attachments were not saved" : "Unable to file complaint",
        description: error instanceof Error ? error.message : "An unexpected error occurred.",
        variant: "destructive",
      });
      if (complaintFiled) {
        setOpen(false);
        setForm({ title: "", description: "", category: "Other", is_urgent: false });
        clearAttachments();
        await refetch();
      }
    } finally {
      setSaving(false);
    }
  };

  const cancel = async (complaintId: number) => {
    try {
      await cancelTenantComplaint(complaintId);
      await refetch();
    } catch (error) {
      toast({
        title: "Unable to cancel complaint",
        description: error instanceof Error ? error.message : "An unexpected error occurred.",
        variant: "destructive",
      });
    }
  };

  const variant = (s: string): "default" | "secondary" | "destructive" =>
    s === "Resolved" ? "default" : s === "Submitted" ? "destructive" : "secondary";

  return (
    <DashboardLayout role="tenant">
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-3 flex-wrap sm:items-center">
          <div>
            <h1 className="font-display text-2xl font-bold">My Complaints</h1>
          </div>
          <Button onClick={() => setOpen(true)} className="gap-2"><Plus size={16} /> File Complaint</Button>
        </div>
        {!userId && <div className="p-3 rounded-md border border-warning/30 bg-warning/10 text-warning text-xs">Sign in to view your complaints.</div>}
        {error && <div className="p-3 rounded-md border border-destructive/30 bg-destructive/10 text-destructive text-xs">{error}</div>}
        {userId && !data && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 size={14} className="animate-spin" /> Loading…</div>}
        {data?.length === 0 && <p className="text-sm text-muted-foreground">No complaints filed yet.</p>}

        <div className="space-y-3">
          {data?.map((c) => (
            <div key={c.complaint_id} className="bg-card border border-border rounded-lg p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <MessageSquareWarning size={16} className="text-primary mt-1" />
                  <div className="min-w-0">
                    <p className="font-medium text-sm">{c.title}</p>
                    <p className="text-xs text-muted-foreground">{c.category} · {formatPhilippineDateTime(c.created_at)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={variant(c.status)} className="text-xs">{c.status}</Badge>
                  {c.is_urgent === 1 && <Badge variant="destructive" className="text-xs">Urgent</Badge>}
                  {c.status === "Submitted" && (
                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => void cancel(c.complaint_id)}><X size={14} /></Button>
                  )}
                </div>
              </div>
              <p className="text-sm text-muted-foreground">{c.description}</p>
              <RequestAttachmentList
                attachments={c.attachments}
                legacyPhotoUrl={c.photo_url}
                requestLabel="Complaint"
              />
              {c.status_history && c.status_history.length > 0 && (
                <div className="mt-3 border-l-2 border-border pl-3 space-y-2">
                  {c.status_history.map((entry, index) => (
                    <div key={`${entry.status}-${entry.changed_at}-${index}`} className="text-xs">
                      <span className="font-medium">{entry.status}</span>
                      <span className="text-muted-foreground"> · {formatPhilippineDateTime(entry.changed_at)}</span>
                    </div>
                  ))}
                </div>
              )}
              {c.admin_reply && (
                <div className="mt-3 p-3 rounded-md bg-primary/5 border border-primary/20 text-xs">
                  <p className="font-medium text-primary mb-1">Admin reply</p>
                  <p>{c.admin_reply}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>File Complaint</DialogTitle><DialogDescription>Your concern goes to the admin.</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-1.5"><Label>Title</Label>
              <Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></div>
            <div className="grid gap-1.5"><Label>Category</Label>
              <Select value={form.category} onValueChange={v => setForm({ ...form, category: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Plumbing">Plumbing</SelectItem>
                  <SelectItem value="Electrical">Electrical</SelectItem>
                  <SelectItem value="Noise">Noise</SelectItem>
                  <SelectItem value="Security">Security</SelectItem>
                  <SelectItem value="Sanitation">Sanitation</SelectItem>
                  <SelectItem value="Internet">Internet</SelectItem>
                  <SelectItem value="General">General</SelectItem>
                  <SelectItem value="Other">Other</SelectItem>
                </SelectContent>
              </Select></div>
            <div className="grid gap-1.5"><Label>Description</Label>
              <Textarea rows={5} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
            <div className="grid gap-1.5">
              <Label htmlFor="complaint-photos">Images (optional, up to 5)</Label>
              <Input
                ref={photosInputRef}
                id="complaint-photos"
                type="file"
                multiple
                accept="image/jpeg,image/png,image/webp"
                onChange={event => {
                  const selectedFiles = Array.from(event.target.files ?? []);
                  event.target.value = "";
                  if (photos.length + selectedFiles.length > 5) {
                    toast({ title: "You can attach up to five images", variant: "destructive" });
                    return;
                  }
                  if (selectedFiles.some(file =>
                    !["image/jpeg", "image/png", "image/webp"].includes(file.type)
                    || file.size <= 0
                    || file.size > 10 * 1024 * 1024
                  )) {
                    toast({ title: "Choose JPG, PNG, or WEBP images up to 10MB each", variant: "destructive" });
                    return;
                  }
                  setPhotos(current => [...current, ...selectedFiles]);
                }}
              />
              <p className="text-xs text-muted-foreground">JPG, PNG, or WEBP up to 10MB each.</p>
              {photos.map((file, index) => (
                <div key={`${file.name}-${file.lastModified}-${index}`} className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate">{file.name}</span>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 shrink-0"
                    aria-label={`Remove image ${file.name}`}
                    onClick={() => setPhotos(current => current.filter((_, itemIndex) => itemIndex !== index))}
                  >
                    <X size={14} />
                  </Button>
                </div>
              ))}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="complaint-video">Video (optional)</Label>
              <Input
                ref={videoInputRef}
                id="complaint-video"
                type="file"
                accept="video/mp4,video/webm,video/quicktime"
                onChange={event => {
                  const selectedFile = event.target.files?.[0] ?? null;
                  event.target.value = "";
                  if (selectedFile && (
                    !["video/mp4", "video/webm", "video/quicktime"].includes(selectedFile.type)
                    || selectedFile.size <= 0
                    || selectedFile.size > 50 * 1024 * 1024
                  )) {
                    toast({ title: "Choose an MP4, WEBM, or MOV video up to 50MB", variant: "destructive" });
                    return;
                  }
                  setVideo(selectedFile);
                }}
              />
              <p className="text-xs text-muted-foreground">MP4, WEBM, or MOV up to 50MB.</p>
              {video && (
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate">{video.name}</span>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 shrink-0"
                    aria-label="Remove video"
                    onClick={() => setVideo(null)}
                  >
                    <X size={14} />
                  </Button>
                </div>
              )}
            </div>
            <div className="space-y-2 rounded-md border border-destructive/30 p-3">
              <Button type="button" variant={form.is_urgent ? "destructive" : "outline"} className="gap-2" aria-pressed={form.is_urgent} onClick={() => setForm({ ...form, is_urgent: !form.is_urgent })}>
                <AlertTriangle size={16} /> {form.is_urgent ? "Urgent complaint selected" : "Mark as urgent"}
              </Button>
              {form.is_urgent && <p className="text-xs text-destructive">This attempts to alert the administrator by SMS. It is not a replacement for local emergency services.</p>}
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

export default TenantComplaints;
