import { DashboardLayout } from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Search, MoreHorizontal, Phone, Mail, Trash2, UserX, UserCheck, Loader2, UserRound, LayoutGrid, Table2, Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { usePolling } from "@/hooks/usePolling";
import { api, API_BASE_URL, type ApiResponse } from "@/lib/api";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface Guest {
  user_id: number;
  full_name: string;
  username: string;
  email: string;
  phone: string | null;
  address: string | null;
  age: number | string | null;
  birthday: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  is_active: number;
  created_at: string;
  profile_picture?: string | null;
}

const ENDPOINT = "/Admin/guests.php";

const AdminGuests = () => {
  const { toast } = useToast();
  const { data: guests, refetch, error } = usePolling<Guest[]>(
    `${ENDPOINT}?action=list`,
    { intervalMs: 5000 }
  );
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"cards" | "table">("cards");
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [selected, setSelected] = useState<Guest | null>(null);
  const [editForm, setEditForm] = useState({
    full_name: "",
    username: "",
    email: "",
    phone: "",
    address: "",
    birthday: "",
    emergency_contact_name: "",
    emergency_contact_phone: "",
    new_password: "",
  });
  const [addForm, setAddForm] = useState({
    full_name: "",
    username: "",
    email: "",
    phone: "",
    address: "",
    birthday: "",
    emergency_contact_name: "",
    emergency_contact_phone: "",
    password: "",
  });
  const [saving, setSaving] = useState(false);
  const [addPicture, setAddPicture] = useState<File | null>(null);
  const [editPicture, setEditPicture] = useState<File | null>(null);
  const currentDate = new Date();
  const maxBirthday = [
    currentDate.getFullYear(),
    String(currentDate.getMonth() + 1).padStart(2, "0"),
    String(currentDate.getDate()).padStart(2, "0"),
  ].join("-");

  const uploadProfilePicture = async (userId: number, file: File) => {
    const formData = new FormData();
    formData.append("user_id", String(userId));
    formData.append("profile_picture", file);
    const res = await api.post<ApiResponse>("/Admin/settings.php?action=upload_user_profile_picture", formData, {
      headers: { "Content-Type": undefined },
    });
    if (res.data.type !== "success") throw new Error(res.data.message || "Unable to upload profile picture");
  };

  const validPicture = (file: File) => ["image/jpeg", "image/png", "image/webp"].includes(file.type) && file.size <= 10 * 1024 * 1024;

  const openEdit = (guest: Guest) => {
    setSelected(guest);
    setEditPicture(null);
    setEditForm({
      full_name: guest.full_name,
      username: guest.username,
      email: guest.email,
      phone: guest.phone ?? "",
      address: guest.address ?? "",
      birthday: guest.birthday ?? "",
      emergency_contact_name: guest.emergency_contact_name ?? "",
      emergency_contact_phone: guest.emergency_contact_phone ?? "",
      new_password: "",
    });
    setEditOpen(true);
  };

  const editAge = (() => {
    if (!editForm.birthday) return "";
    const birthDate = new Date(`${editForm.birthday}T00:00:00`);
    if (Number.isNaN(birthDate.getTime())) return "";
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    if (
      today.getMonth() < birthDate.getMonth() ||
      (today.getMonth() === birthDate.getMonth() && today.getDate() < birthDate.getDate())
    ) age -= 1;
    return age >= 0 ? age : "";
  })();

  const saveGuest = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const res = await api.post<ApiResponse>(`${ENDPOINT}?action=update`, {
        ...editForm,
        user_id: selected.user_id,
      });
      if (res.data.type === "success") {
        let pictureFailed = false;
        if (editPicture) {
          try {
            await uploadProfilePicture(selected.user_id, editPicture);
          } catch {
            pictureFailed = true;
          }
        }
        toast({
          title: pictureFailed ? "Guest updated, but picture upload failed" : "Guest account updated",
          variant: pictureFailed ? "destructive" : "default",
        });
        setEditOpen(false);
        setEditPicture(null);
        refetch();
      } else toast({ title: res.data.message || "Update failed", variant: "destructive" });
    } catch (error) {
      toast({
        title: error instanceof Error ? error.message : "Unable to update guest account",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const createGuest = async () => {
    setSaving(true);
    try {
      const res = await api.post<ApiResponse>(`${ENDPOINT}?action=create`, addForm);
      if (res.data.type === "success") {
        const userId = Number(res.data.user_id);
        let pictureFailed = false;
        if (addPicture && userId > 0) {
          try {
            await uploadProfilePicture(userId, addPicture);
          } catch {
            pictureFailed = true;
          }
        }
        toast({
          title: pictureFailed ? "Guest created, but picture upload failed" : "Guest account created",
          variant: pictureFailed ? "destructive" : "default",
        });
        setAddOpen(false);
        setAddPicture(null);
        setAddForm({ full_name: "", username: "", email: "", phone: "", address: "", birthday: "", emergency_contact_name: "", emergency_contact_phone: "", password: "" });
        refetch();
      } else toast({ title: res.data.message || "Creation failed", variant: "destructive" });
    } catch (error) {
      toast({ title: error instanceof Error ? error.message : "Unable to create guest account", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (g: Guest) => {
    const action = g.is_active ? "deactivate" : "activate";
    const res = await api.get<ApiResponse>(`${ENDPOINT}?action=${action}&user_id=${g.user_id}`);
    toast({ title: res.data.message || "Updated" });
    refetch();
  };

  const handleDelete = async () => {
    if (!selected) return;
    const res = await api.get<ApiResponse>(`${ENDPOINT}?action=delete&user_id=${selected.user_id}`);
    toast({
      title: res.data.message || (res.data.type === "success" ? "Deleted" : "Failed"),
      variant: res.data.type === "success" ? "default" : "destructive",
    });
    setDelOpen(false);
    refetch();
  };

  const filtered = (guests ?? []).filter((g) =>
    !search ||
    g.full_name.toLowerCase().includes(search.toLowerCase()) ||
    g.email.toLowerCase().includes(search.toLowerCase()) ||
    g.username.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <DashboardLayout role="admin">
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold">Guest Accounts</h1>
            <p className="text-muted-foreground text-sm mt-1">View and manage guest accounts and their booking activity.</p>
            {guests && (
              <p className="text-muted-foreground text-sm mt-1">
                {guests.length} guest{guests.length === 1 ? "" : "s"}
              </p>
            )}
          </div>
          <Button onClick={() => setAddOpen(true)} className="gap-2"><Plus size={16} /> Add Guest</Button>
        </div>

        {error && (
          <div className="p-3 rounded-md border border-destructive/30 bg-destructive/10 text-destructive text-xs">
            {error}
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, username, or email..."
              className="pl-10"
            />
          </div>
          <div className="flex shrink-0 gap-2" role="group" aria-label="Guest account view">
            <Button type="button" variant={view === "cards" ? "default" : "outline"} size="icon" aria-label="Card view" aria-pressed={view === "cards"} onClick={() => setView("cards")}>
              <LayoutGrid size={16} aria-hidden="true" />
            </Button>
            <Button type="button" variant={view === "table" ? "default" : "outline"} size="icon" aria-label="Table view" aria-pressed={view === "table"} onClick={() => setView("table")}>
              <Table2 size={16} aria-hidden="true" />
            </Button>
          </div>
        </div>

        {!guests && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 size={14} className="animate-spin" /> Loading…
          </div>
        )}
        {guests && filtered.length === 0 && (
          <div className="p-8 text-center text-muted-foreground bg-card border border-border rounded-lg">
            No guest accounts found.
          </div>
        )}

        {view === "cards" ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((g) => (
            <div key={g.user_id} className="bg-card border border-border rounded-lg p-5 space-y-3 flex flex-col justify-between">
              <div className="space-y-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-accent/20 flex items-center justify-center text-accent-foreground overflow-hidden">
                      {g.profile_picture ? <img src={`${API_BASE_URL}/Config/profile_picture.php?user_id=${g.user_id}&v=${encodeURIComponent(g.profile_picture)}`} alt="Profile" className="h-full w-full object-cover" /> : <UserRound size={18} />}
                    </div>
                    <div>
                      <p className="font-medium text-sm">{g.full_name}</p>
                      <p className="text-xs text-muted-foreground">@{g.username}</p>
                    </div>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreHorizontal size={16} />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => openEdit(g)} className="gap-2">
                        <Pencil size={14} /> Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleToggle(g)} className="gap-2">
                        {g.is_active ? <><UserX size={14} /> Deactivate</> : <><UserCheck size={14} /> Activate</>}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => { setSelected(g); setDelOpen(true); }}
                        className="gap-2 text-destructive"
                      >
                        <Trash2 size={14} /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <div className="space-y-1 text-xs text-muted-foreground">
                  <div className="flex items-center gap-2 truncate"><Mail size={12} /> {g.email}</div>
                  <div className="flex items-center gap-2"><Phone size={12} /> {g.phone || "—"}</div>
                  <div><span className="font-medium text-foreground">Address:</span> {g.address || "—"}</div>
                  <div>
                    <span className="font-medium text-foreground">Birthday / Age:</span>{" "}
                    {g.birthday || "—"} / {g.age ?? "—"}
                  </div>
                  <div>
                    <span className="font-medium text-foreground">Emergency contact:</span>{" "}
                    {g.emergency_contact_name || "—"} · {g.emergency_contact_phone || "—"}
                  </div>
                </div>

              </div>

              <div className="space-y-2 pt-2">
                <div className="flex items-center justify-between pt-2 border-t border-border">
                  <Badge variant={g.is_active ? "default" : "secondary"} className="text-xs">
                    {g.is_active ? "Active" : "Inactive"}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {new Date(g.created_at).toLocaleDateString()}
                  </span>
                </div>

              </div>
            </div>
            ))}
          </div>
        ) : (
          <div className="bg-card border border-border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Address</TableHead>
                  <TableHead>Birthday / Age</TableHead>
                  <TableHead>Emergency Contact</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((g) => (
                  <TableRow key={g.user_id}>
                    <TableCell>
                      <div className="flex items-center gap-3 min-w-44">
                        <div className="h-9 w-9 rounded-full bg-accent/20 flex items-center justify-center text-accent-foreground overflow-hidden shrink-0">
                          {g.profile_picture ? <img src={`${API_BASE_URL}/Config/profile_picture.php?user_id=${g.user_id}&v=${encodeURIComponent(g.profile_picture)}`} alt="" className="h-full w-full object-cover" /> : <UserRound size={16} />}
                        </div>
                        <div>
                          <p className="font-medium">{g.full_name}</p>
                          <p className="text-xs text-muted-foreground">@{g.username}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="min-w-48">
                      <p>{g.email}</p>
                      <p className="text-xs text-muted-foreground">{g.phone || "—"}</p>
                    </TableCell>
                    <TableCell className="min-w-40">{g.address || "—"}</TableCell>
                    <TableCell className="whitespace-nowrap">{g.birthday || "—"} / {g.age ?? "—"}</TableCell>
                    <TableCell className="min-w-44">
                      <p>{g.emergency_contact_name || "—"}</p>
                      <p className="text-xs text-muted-foreground">{g.emergency_contact_phone || "—"}</p>
                    </TableCell>
                    <TableCell><Badge variant={g.is_active ? "default" : "secondary"}>{g.is_active ? "Active" : "Inactive"}</Badge></TableCell>
                    <TableCell className="whitespace-nowrap">{new Date(g.created_at).toLocaleDateString()}</TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Actions for ${g.full_name}`}>
                            <MoreHorizontal size={16} />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEdit(g)} className="gap-2">
                            <Pencil size={14} /> Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleToggle(g)} className="gap-2">
                            {g.is_active ? <><UserX size={14} /> Deactivate</> : <><UserCheck size={14} /> Activate</>}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => { setSelected(g); setDelOpen(true); }} className="gap-2 text-destructive">
                            <Trash2 size={14} /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add Guest Account</DialogTitle>
            <DialogDescription>Create a guest login with personal and emergency contact information.</DialogDescription>
          </DialogHeader>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="guest-add-name">Full name</Label>
              <Input id="guest-add-name" maxLength={150} value={addForm.full_name} onChange={e => setAddForm({ ...addForm, full_name: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="guest-add-username">Username</Label>
              <Input id="guest-add-username" maxLength={50} value={addForm.username} onChange={e => setAddForm({ ...addForm, username: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="guest-add-email">Email</Label>
              <Input id="guest-add-email" type="email" maxLength={150} value={addForm.email} onChange={e => setAddForm({ ...addForm, email: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="guest-add-phone">Phone</Label>
              <Input id="guest-add-phone" type="tel" inputMode="numeric" maxLength={11} placeholder="09XXXXXXXXX" value={addForm.phone} onChange={e => setAddForm({ ...addForm, phone: e.target.value.replace(/\D/g, "").slice(0, 11) })} />
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="guest-add-address">Address</Label>
              <Input id="guest-add-address" maxLength={255} value={addForm.address} onChange={e => setAddForm({ ...addForm, address: e.target.value })} />
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="guest-add-picture">Profile picture (optional)</Label>
              <Input id="guest-add-picture" type="file" accept="image/jpeg,image/png,image/webp" onChange={e => {
                const file = e.target.files?.[0] ?? null;
                if (file && !validPicture(file)) {
                  toast({ title: "Choose a JPG, PNG, or WEBP image up to 10MB", variant: "destructive" });
                  e.target.value = "";
                  return;
                }
                setAddPicture(file);
              }} />
              <p className="text-xs text-muted-foreground">JPG, PNG, or WEBP up to 10MB.</p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="guest-add-birthday">Birthday</Label>
              <Input id="guest-add-birthday" type="date" max={maxBirthday} value={addForm.birthday} onChange={e => setAddForm({ ...addForm, birthday: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="guest-add-age">Age (calculated)</Label>
              <Input id="guest-add-age" value={(() => {
                if (!addForm.birthday) return "";
                const birthDate = new Date(`${addForm.birthday}T00:00:00`);
                if (Number.isNaN(birthDate.getTime())) return "";
                const today = new Date();
                let age = today.getFullYear() - birthDate.getFullYear();
                if (today.getMonth() < birthDate.getMonth() || (today.getMonth() === birthDate.getMonth() && today.getDate() < birthDate.getDate())) age -= 1;
                return age >= 0 ? String(age) : "";
              })()} readOnly placeholder="Set birthday to calculate" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="guest-add-emergency-name">Emergency contact name</Label>
              <Input id="guest-add-emergency-name" maxLength={150} value={addForm.emergency_contact_name} onChange={e => setAddForm({ ...addForm, emergency_contact_name: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="guest-add-emergency-phone">Emergency contact phone</Label>
              <Input id="guest-add-emergency-phone" type="tel" inputMode="numeric" maxLength={11} placeholder="09XXXXXXXXX" value={addForm.emergency_contact_phone} onChange={e => setAddForm({ ...addForm, emergency_contact_phone: e.target.value.replace(/\D/g, "").slice(0, 11) })} />
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="guest-add-password">Temporary password</Label>
              <Input id="guest-add-password" type="password" autoComplete="new-password" maxLength={200} value={addForm.password} onChange={e => setAddForm({ ...addForm, password: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button type="button" onClick={createGuest} disabled={saving}>{saving ? "Saving…" : "Create Guest"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Guest Account</DialogTitle>
            <DialogDescription>Update the guest’s account and personal information.</DialogDescription>
          </DialogHeader>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="guest-edit-name">Full name</Label>
              <Input id="guest-edit-name" maxLength={150} value={editForm.full_name} onChange={e => setEditForm({ ...editForm, full_name: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="guest-edit-username">Login username</Label>
              <Input id="guest-edit-username" value={editForm.username} readOnly />
              <p className="text-xs text-muted-foreground">Usernames cannot be changed.</p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="guest-edit-email">Email</Label>
              <Input id="guest-edit-email" type="email" maxLength={150} value={editForm.email} onChange={e => setEditForm({ ...editForm, email: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="guest-edit-phone">Phone</Label>
              <Input id="guest-edit-phone" type="tel" inputMode="numeric" maxLength={11} placeholder="09XXXXXXXXX" value={editForm.phone} onChange={e => setEditForm({ ...editForm, phone: e.target.value.replace(/\D/g, "").slice(0, 11) })} />
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="guest-edit-address">Address</Label>
              <Input id="guest-edit-address" maxLength={255} value={editForm.address} onChange={e => setEditForm({ ...editForm, address: e.target.value })} />
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="guest-edit-picture">Profile picture</Label>
              <div className="flex items-center gap-3">
                {selected?.profile_picture && (
                  <img src={`${API_BASE_URL}/Config/profile_picture.php?user_id=${selected.user_id}&v=${encodeURIComponent(selected.profile_picture)}`} alt="Current profile" className="h-12 w-12 rounded-full object-cover" />
                )}
                <Input id="guest-edit-picture" type="file" accept="image/jpeg,image/png,image/webp" onChange={e => {
                  const file = e.target.files?.[0] ?? null;
                  if (file && !validPicture(file)) {
                    toast({ title: "Choose a JPG, PNG, or WEBP image up to 10MB", variant: "destructive" });
                    e.target.value = "";
                    return;
                  }
                  setEditPicture(file);
                }} />
              </div>
              <p className="text-xs text-muted-foreground">JPG, PNG, or WEBP up to 10MB.</p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="guest-edit-birthday">Birthday</Label>
              <Input id="guest-edit-birthday" type="date" max={maxBirthday} value={editForm.birthday} onChange={e => setEditForm({ ...editForm, birthday: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="guest-edit-age">Age (calculated)</Label>
              <Input id="guest-edit-age" value={editAge} readOnly placeholder="Set birthday to calculate" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="guest-edit-emergency-name">Emergency contact name</Label>
              <Input id="guest-edit-emergency-name" maxLength={150} value={editForm.emergency_contact_name} onChange={e => setEditForm({ ...editForm, emergency_contact_name: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="guest-edit-emergency-phone">Emergency contact phone</Label>
              <Input id="guest-edit-emergency-phone" type="tel" inputMode="numeric" maxLength={11} placeholder="09XXXXXXXXX" value={editForm.emergency_contact_phone} onChange={e => setEditForm({ ...editForm, emergency_contact_phone: e.target.value.replace(/\D/g, "").slice(0, 11) })} />
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="guest-edit-new-password">New password (optional)</Label>
              <Input id="guest-edit-new-password" type="password" autoComplete="new-password" maxLength={200} value={editForm.new_password} onChange={e => setEditForm({ ...editForm, new_password: e.target.value })} />
              <p className="text-xs text-muted-foreground">Leave blank to keep the current password.</p>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button type="button" onClick={saveGuest} disabled={saving}>
              {saving ? "Saving…" : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={delOpen} onOpenChange={setDelOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete guest account?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes {selected?.full_name}'s account.
            </AlertDialogDescription>
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

export default AdminGuests;
