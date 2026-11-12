import { DashboardLayout } from "@/components/DashboardLayout";
import { RoomPhotosManager, type RoomPhotosManagerHandle } from "@/components/RoomPhotosManager";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Plus, Pencil, Trash2, BedDouble, Loader2 } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import { usePolling } from "@/hooks/usePolling";
import { api, endpoints, type ApiResponse, API_BASE_URL } from "@/lib/api";

interface Room {
  room_id: number;
  room_number: string;
  room_type: string;
  capacity: number;
  monthly_rent: number;
  status: string;
  description: string;
  image?: string;
  occupants: number;
}

const empty = { room_number: "", room_type: "Single", capacity: 1, monthly_rent: 0, status: "Available", description: "" };

const AdminRooms = () => {
  const { toast } = useToast();
  const { data: rooms, refetch, error } = usePolling<Room[]>(`${endpoints.adminRooms}?action=list`, { intervalMs: 5000 });
  const [open, setOpen] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [selected, setSelected] = useState<Room | null>(null);
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const photoManagerRef = useRef<RoomPhotosManagerHandle>(null);

  const openAdd = () => {
    if (imagePreview?.startsWith("blob:")) URL.revokeObjectURL(imagePreview);
    setSelected(null);
    setForm(empty);
    setImageFile(null);
    setImagePreview(null);
    setOpen(true);
  };
  const openEdit = (r: Room) => {
    if (imagePreview?.startsWith("blob:")) URL.revokeObjectURL(imagePreview);
    setSelected(r);
    setForm({
      room_number: r.room_number, room_type: r.room_type, capacity: r.capacity,
      monthly_rent: r.monthly_rent, status: r.status, description: r.description || "",
    });
    setImageFile(null);
    setImagePreview(r.image || null);
    setOpen(true);
  };

  useEffect(() => {
    if (!open) {
      if (imagePreview?.startsWith("blob:")) URL.revokeObjectURL(imagePreview);
      setImageFile(null);
      setImagePreview(null);
    }
  }, [open, imagePreview]);

  const handleSave = async () => {
    setSaving(true);
    try {
      if (!photoManagerRef.current) throw new Error("Room photos are not ready to save. Please try again.");
      const captionsSaved = await photoManagerRef.current.savePendingCaptions();
      if (!captionsSaved) return;

      const wasEditing = Boolean(selected);
      const url = wasEditing
        ? `${endpoints.adminRooms}?action=update`
        : `${endpoints.adminRooms}?action=create`;
      const formData = new FormData();
      formData.append('room_number', form.room_number);
      formData.append('room_type', form.room_type);
      formData.append('capacity', String(form.capacity));
      formData.append('monthly_rent', String(form.monthly_rent));
      formData.append('status', form.status);
      formData.append('description', form.description || '');
      if (selected) formData.append('room_id', String(selected.room_id));
      if (imageFile) {
        formData.append('image', imageFile);
      } else if (selected && imagePreview) {
        // send only filename for existing image (server will normalize)
        const existing = imagePreview.includes('/') ? imagePreview.split('/').pop() : imagePreview;
        formData.append('existing_image', existing as string);
      }
      // Clear the default JSON Content-Type on the axios instance for this
      // request so the browser can set the multipart boundary automatically.
      const res = await api.post<ApiResponse>(url, formData, { headers: { 'Content-Type': undefined } });
      if (res.data.type !== "success") {
        toast({ title: res.data.message || "Failed to save room", variant: "destructive" });
        return;
      }

      let savedRoomId = selected?.room_id;
      if (!wasEditing) {
        const createdRoomId = Number(res.data.room_id);
        if (!Number.isInteger(createdRoomId) || createdRoomId <= 0) {
          throw new Error("The room was created, but the server did not return its room ID.");
        }
        savedRoomId = createdRoomId;
        setSelected({
          room_id: createdRoomId,
          ...form,
          occupants: 0,
          image: undefined,
        });
        if (imagePreview?.startsWith("blob:")) URL.revokeObjectURL(imagePreview);
        setImageFile(null);
        setImagePreview(null);
      }

      if (!savedRoomId) throw new Error("The saved room ID is unavailable.");
      const photoResult = await photoManagerRef.current.uploadPending(savedRoomId);
      if (photoResult && photoResult.failedCount > 0) {
        const details = [...new Set(photoResult.errors
          .map((item) => item.message)
          .filter(Boolean))]
          .join("; ");
        toast({
          title: `Room saved, but ${photoResult.failedCount} photo${photoResult.failedCount === 1 ? "" : "s"} failed`,
          description: details || "Review the remaining photos and save again to retry.",
          variant: "destructive",
        });
        return;
      }

      toast({ title: wasEditing ? "Room updated" : "Room created" });
      setOpen(false);
      refetch();
    } catch (error: unknown) {
      const message = typeof error === "object" && error !== null && "response" in error
        ? (error as { response?: { data?: { message?: string } } }).response?.data?.message
        : undefined;
      toast({
        title: "Failed to save room",
        description: message || (error instanceof Error ? error.message : "An unexpected error occurred"),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selected) return;
    const res = await api.get<ApiResponse>(`${endpoints.adminRooms}?action=delete&room_id=${selected.room_id}`);
    toast({ title: res.data.message || "Done", variant: res.data.type === "success" ? "default" : "destructive" });
    setDelOpen(false); refetch();
  };

  const setStatus = async (r: Room, status: string) => {
    await api.get<ApiResponse>(`${endpoints.adminRooms}?action=set_status&room_id=${r.room_id}&status=${status}`);
    refetch();
  };

  const variant = (s: string): "default" | "secondary" | "destructive" =>
    s === "Available" ? "default" : s === "Occupied" ? "secondary" : "destructive";

  return (
    <DashboardLayout role="admin">
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="font-display text-2xl font-bold">Rooms Management</h1>
            <p className="text-muted-foreground text-sm mt-1">Manage room details, rates, availability, and occupancy.</p>
          </div>
          <Button onClick={openAdd} className="gap-2"><Plus size={16} /> Add Room</Button>
        </div>
        {error && <div className="p-3 rounded-md border border-destructive/30 bg-destructive/10 text-destructive text-xs">{error}</div>}
        {!rooms && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 size={14} className="animate-spin" /> Loading…</div>}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {rooms?.map((r) => (
            <div key={r.room_id} className="bg-card border border-border rounded-lg p-5 space-y-3">
              {r.image && (
                <img
                  src={
                    r.image.startsWith('http') ? r.image
                    : r.image.includes('/') ? `${API_BASE_URL}/${r.image}`
                    : `${API_BASE_URL}/uploads/rooms/${r.image}`
                  }
                  alt={`Room ${r.room_number}`}
                  className="w-full h-36 object-cover rounded-md mb-2"
                />
              )}
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-md bg-primary/10 flex items-center justify-center text-primary"><BedDouble size={20} /></div>
                  <div>
                    <p className="font-medium text-sm">Room {r.room_number}</p>
                    <p className="text-xs text-muted-foreground">{r.room_type} · cap {r.capacity}</p>
                  </div>
                </div>
                <Badge variant={variant(r.status)} className="text-xs">{r.status}</Badge>
              </div>
              <p className="text-xs text-muted-foreground line-clamp-2">{r.description || "—"}</p>
              <div className="flex items-center justify-between pt-2 border-t border-border">
                <span className="font-semibold text-sm">₱{Number(r.monthly_rent).toLocaleString()}/mo</span>
                <span className="text-xs text-muted-foreground">
                  {r.occupants} occupant(s)
                  {Number(r.capacity) >= 2 && ` · ${Math.max(0, Number(r.capacity) - Number(r.occupants))} bedspace${Number(r.capacity) - Number(r.occupants) === 1 ? "" : "s"} available`}
                </span>
              </div>
              <div className="flex gap-2 pt-1">
                <Select value={r.status} onValueChange={(v) => setStatus(r, v)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Available">Available</SelectItem>
                    <SelectItem value="Occupied">Occupied</SelectItem>
                    <SelectItem value="Reserved">Reserved</SelectItem>
                    <SelectItem value="Maintenance">Maintenance</SelectItem>
                  </SelectContent>
                </Select>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(r)}><Pencil size={14} /></Button>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => { setSelected(r); setDelOpen(true); }}><Trash2 size={14} /></Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selected ? "Edit" : "Add"} Room</DialogTitle>
            <DialogDescription>Room details.</DialogDescription>
          </DialogHeader>
            <div className="space-y-3">
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="grid gap-1.5"><Label>Room # *</Label>
                <Input value={form.room_number} onChange={e => setForm({ ...form, room_number: e.target.value })} /></div>
              <div className="grid gap-1.5"><Label>Type</Label>
                <Select value={form.room_type} onValueChange={(v) => setForm({ ...form, room_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Single">Single</SelectItem>
                    <SelectItem value="Double">Double</SelectItem>
                    <SelectItem value="Suite">Suite</SelectItem>
                  </SelectContent>
                </Select></div>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="grid gap-1.5"><Label>Capacity</Label>
                <Input type="number" min={1} value={form.capacity} onChange={e => setForm({ ...form, capacity: +e.target.value })} /></div>
              <div className="grid gap-1.5"><Label>Monthly Rent (₱)</Label>
                <Input type="number" min={0} value={form.monthly_rent} onChange={e => setForm({ ...form, monthly_rent: +e.target.value })} /></div>
            </div>
            <div className="grid gap-1.5"><Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Available">Available</SelectItem>
                  <SelectItem value="Occupied">Occupied</SelectItem>
                  <SelectItem value="Reserved">Reserved</SelectItem>
                  <SelectItem value="Maintenance">Maintenance</SelectItem>
                </SelectContent>
              </Select></div>
            <div className="grid gap-1.5"><Label>Image</Label>
              <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => {
                const f = e.target.files?.[0] || null;
                if (f) {
                  if (!["image/jpeg", "image/png", "image/webp"].includes(f.type)) {
                    toast({ title: "Choose a JPG, PNG, or WEBP image", variant: "destructive" });
                    e.target.value = "";
                    setImageFile(null);
                    if (imagePreview?.startsWith("blob:")) URL.revokeObjectURL(imagePreview);
                    setImagePreview(selected?.image ?? null);
                    return;
                  }
                  if (imagePreview?.startsWith("blob:")) URL.revokeObjectURL(imagePreview);
                  setImageFile(f);
                  setImagePreview(URL.createObjectURL(f));
                }
              }} /></div>
            {imagePreview && (
              <div className="grid gap-1.5">
                <img
                  src={
                    imagePreview.startsWith('http') ? imagePreview
                    : imagePreview.includes('/') ? `${API_BASE_URL}/${imagePreview}`
                    : `${API_BASE_URL}/uploads/rooms/${imagePreview}`
                  }
                  className="w-full h-40 object-cover rounded-md"
                />
              </div>
            )}
            <RoomPhotosManager
              ref={photoManagerRef}
              roomId={selected?.room_id ?? null}
              enabled={open}
              disabled={saving}
            />
            <div className="grid gap-1.5"><Label>Description</Label>
              <Textarea rows={3} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 size={14} className="animate-spin" />}
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={delOpen} onOpenChange={setDelOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Room {selected?.room_number}?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
};

export default AdminRooms;
