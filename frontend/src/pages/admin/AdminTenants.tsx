import { DashboardLayout } from "@/components/DashboardLayout";
import { ImagePreview } from "@/components/ImagePreview";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Search, Plus, MoreHorizontal, Phone, Mail, Pencil, Trash2, UserX, Loader2, UserRound, LayoutGrid, Table2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { useSupabasePolling } from "@/hooks/useSupabasePolling";
import { getProfilePictureUrl } from "@/lib/profileSettings";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  createAdminTenant,
  deactivateAdminTenant,
  deleteAdminTenant,
  findAdminTenantAccounts,
  listAdminTenants,
  updateAdminTenant,
  uploadAdminTenantPicture,
  type AdminTenantAccountSuggestion,
  type AdminTenant,
} from "@/lib/adminTenants";

const AdminTenants = () => {
  const { toast } = useToast();
  const loadTenants = useCallback(() => listAdminTenants(), []);
  const { data: tenants, refetch, error } = useSupabasePolling(loadTenants, 5000);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"cards" | "table">("cards");
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [selected, setSelected] = useState<AdminTenant | null>(null);
  const [saving, setSaving] = useState(false);
  const [tenantPicture, setTenantPicture] = useState<File | null>(null);
  const [accountSuggestions, setAccountSuggestions] = useState<AdminTenantAccountSuggestion[]>([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggestionsError, setSuggestionsError] = useState("");

  const [form, setForm] = useState({
    full_name: "", email: "", phone: "", address: "", birthday: "", emergency_contact_name: "", emergency_contact_phone: "",
    room_id: "", move_in_date: "", move_out_date: "", username: "", new_password: "",
  });

  const resetForm = () =>
    setForm({
      full_name: "", email: "", phone: "", address: "", birthday: "", emergency_contact_name: "", emergency_contact_phone: "",
      room_id: "", move_in_date: "", move_out_date: "", username: "", new_password: "",
    });

  const validPicture = (file: File) => ["image/jpeg", "image/png", "image/webp"].includes(file.type) && file.size <= 10 * 1024 * 1024;
  useEffect(() => {
    const query = form.username.trim();
    const canSuggestAccount = addOpen || (editOpen && selected?.user_id == null);
    if (!canSuggestAccount || query.length < 2) {
      setAccountSuggestions([]);
      setSuggestionsLoading(false);
      setSuggestionsError("");
      return;
    }

    let cancelled = false;
    setSuggestionsLoading(true);
    setSuggestionsError("");
    const timer = window.setTimeout(async () => {
      try {
        const suggestions = await findAdminTenantAccounts(query);
        if (cancelled) return;
        setAccountSuggestions(suggestions);
      } catch (error) {
        if (cancelled) return;
        setSuggestionsError(error instanceof Error ? error.message : "Unable to load account suggestions.");
        setAccountSuggestions([]);
      } finally {
        if (!cancelled) setSuggestionsLoading(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [addOpen, editOpen, form.username, selected?.user_id]);

  const selectAccountSuggestion = (account: AdminTenantAccountSuggestion) => {
    setForm(current => ({
      ...current,
      username: account.username,
      full_name: account.full_name,
      email: account.email,
      phone: account.phone ?? "",
      address: account.address ?? "",
      birthday: account.birthday ?? "",
      emergency_contact_name: account.emergency_contact_name ?? "",
      emergency_contact_phone: account.emergency_contact_phone ?? "",
    }));
    setAccountSuggestions([]);
    setSuggestionsOpen(false);
  };

  const openAdd = () => { resetForm(); setTenantPicture(null); setAddOpen(true); };
  const openEdit = (t: AdminTenant) => {
    setSelected(t);
    setTenantPicture(null);
    setForm({
      full_name: t.full_name, email: t.email, phone: t.phone,
      address: t.address ?? "", birthday: t.birthday ?? "",
      emergency_contact_name: t.emergency_contact_name ?? "", emergency_contact_phone: t.emergency_contact_phone ?? "",
      room_id: t.room_id ? String(t.room_id) : "", move_in_date: t.move_in_date, move_out_date: t.move_out_date ?? "",
      username: t.username ?? "", new_password: "",
    });
    setEditOpen(true);
  };

  const handleAdd = async () => {
    setSaving(true);
    try {
      const response = await createAdminTenant(form);
      let pictureFailed = false;
      if (tenantPicture && response.user_id) {
        try {
          await uploadAdminTenantPicture(response.user_id, tenantPicture);
        } catch {
          pictureFailed = true;
        }
      }
      toast({ title: pictureFailed ? "Tenant added, but picture upload failed" : "Tenant added", variant: pictureFailed ? "destructive" : "default" });
      setAddOpen(false); setTenantPicture(null); refetch();
    } catch (error) {
      toast({ title: error instanceof Error ? error.message : "Unable to add tenant", variant: "destructive" });
    } finally { setSaving(false); }
  };

  const handleEdit = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const response = await updateAdminTenant({ ...form, tenant_id: selected.tenant_id });
      const userId = response.user_id ?? selected.user_id;
      let pictureFailed = false;
      if (tenantPicture && userId) {
        try {
          await uploadAdminTenantPicture(userId, tenantPicture);
        } catch {
          pictureFailed = true;
        }
      }
      toast({ title: pictureFailed ? "Tenant updated, but picture upload failed" : "Tenant updated", variant: pictureFailed ? "destructive" : "default" });
      setEditOpen(false); setTenantPicture(null); refetch();
    } catch (error) {
      toast({ title: error instanceof Error ? error.message : "Unable to update tenant", variant: "destructive" });
    } finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!selected) return;
    try {
      await deleteAdminTenant(selected.tenant_id);
      toast({ title: "Tenant deleted" });
      setDelOpen(false);
      refetch();
    } catch (error) {
      toast({ title: error instanceof Error ? error.message : "Unable to delete tenant", variant: "destructive" });
    }
  };

  const handleDeactivate = async (t: AdminTenant) => {
    try {
      await deactivateAdminTenant(t.tenant_id);
      toast({ title: "Tenant deactivated" });
      refetch();
    } catch (error) {
      toast({ title: error instanceof Error ? error.message : "Unable to deactivate tenant", variant: "destructive" });
    }
  };

  const filtered = (tenants ?? []).filter((t) =>
    !search ||
    t.full_name.toLowerCase().includes(search.toLowerCase()) ||
    (t.username ?? "").toLowerCase().includes(search.toLowerCase()) ||
    (t.room_number ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const fields = (
    <div className="space-y-3">
      <div className="grid gap-1.5"><Label>Full Name *</Label>
        <Input value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} /></div>
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="grid gap-1.5"><Label>Email *</Label>
          <Input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
        <div className="grid gap-1.5"><Label>Phone *</Label>
          <Input
            type="tel"
            inputMode="numeric"
            maxLength={11}
            placeholder="09XXXXXXXXX"
            value={form.phone}
            onChange={e => setForm({ ...form, phone: e.target.value.replace(/\D/g, "").slice(0, 11) })}
          /></div>
      </div>
      <div className="grid gap-1.5"><Label>Address</Label>
        <Input maxLength={255} value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} /></div>
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="grid gap-1.5"><Label>Birthday</Label>
          <Input type="date" value={form.birthday} onChange={e => setForm({ ...form, birthday: e.target.value })} /></div>
        <div className="grid gap-1.5"><Label>Age (calculated)</Label>
          <Input value={form.birthday ? (() => {
            const birthDate = new Date(`${form.birthday}T00:00:00`);
            if (Number.isNaN(birthDate.getTime())) return "";
            const today = new Date();
            let age = today.getFullYear() - birthDate.getFullYear();
            if (today.getMonth() < birthDate.getMonth() || (today.getMonth() === birthDate.getMonth() && today.getDate() < birthDate.getDate())) age -= 1;
            return age >= 0 ? String(age) : "";
          })() : ""} readOnly placeholder="Set birthday to calculate" /></div>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="grid gap-1.5"><Label>Emergency contact name</Label>
          <Input maxLength={150} value={form.emergency_contact_name} onChange={e => setForm({ ...form, emergency_contact_name: e.target.value })} /></div>
        <div className="grid gap-1.5"><Label>Emergency contact phone</Label>
          <Input type="tel" inputMode="numeric" maxLength={11} placeholder="09XXXXXXXXX" value={form.emergency_contact_phone} onChange={e => setForm({ ...form, emergency_contact_phone: e.target.value.replace(/\D/g, "").slice(0, 11) })} /></div>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="grid gap-1.5"><Label>Room ID</Label>
          <Input type="number" min="1" value={form.room_id} onChange={e => setForm({ ...form, room_id: e.target.value })} placeholder="Optional room ID" /></div>
        <div className="grid gap-1.5"><Label>Move-in *</Label>
          <Input type="date" value={form.move_in_date} onChange={e => setForm({ ...form, move_in_date: e.target.value })} /></div>
      </div>
      <div className="grid gap-1.5"><Label>Move-out date</Label>
        <Input type="date" value={form.move_out_date} onChange={e => setForm({ ...form, move_out_date: e.target.value })} /></div>
      {editOpen && selected?.user_id != null ? (
        <div className="grid gap-1.5">
          <Label htmlFor="tenant-edit-username">Login username</Label>
          <Input id="tenant-edit-username" value={form.username} readOnly />
          <p className="text-xs text-muted-foreground">Usernames cannot be changed.</p>
        </div>
      ) : (
        <div className="grid gap-1.5 relative">
          <Label htmlFor="tenant-account-username">Link an existing Tenant login (optional)</Label>
          <Input
            id="tenant-account-username"
            maxLength={50}
            value={form.username}
            autoComplete="off"
            onFocus={() => setSuggestionsOpen(true)}
            onChange={e => {
              setForm({ ...form, username: e.target.value });
              setSuggestionsOpen(true);
            }}
            placeholder="Type at least 2 characters to search"
            aria-autocomplete="list"
            aria-expanded={suggestionsOpen && accountSuggestions.length > 0}
            aria-controls="tenant-account-suggestions"
          />
          {suggestionsOpen && form.username.trim().length >= 2 && (
            <div id="tenant-account-suggestions" role="listbox" className="absolute z-50 top-full mt-1 w-full rounded-md border border-border bg-popover p-1 shadow-md">
              {suggestionsLoading && <p className="px-3 py-2 text-sm text-muted-foreground">Searching accounts…</p>}
              {!suggestionsLoading && suggestionsError && <p className="px-3 py-2 text-sm text-destructive">{suggestionsError}</p>}
              {!suggestionsLoading && !suggestionsError && accountSuggestions.length === 0 && (
                <p className="px-3 py-2 text-sm text-muted-foreground">No unlinked active account matches this username.</p>
              )}
              {!suggestionsLoading && accountSuggestions.map(account => (
                <button
                  key={account.user_id}
                  type="button"
                  role="option"
                  aria-selected={form.username === account.username}
                  onMouseDown={event => event.preventDefault()}
                  onClick={() => selectAccountSuggestion(account)}
                  className="flex w-full flex-col items-start rounded-sm px-3 py-2 text-left hover:bg-accent hover:text-accent-foreground"
                >
                  <span className="text-sm font-medium">@{account.username}</span>
                  <span className="text-xs text-muted-foreground">{account.full_name} · {account.email} · {account.user_type}</span>
                </button>
              ))}
            </div>
          )}
          <p className="text-xs text-muted-foreground">Only active Tenant accounts not already linked to an active tenant record can be selected.</p>
        </div>
      )}
      {editOpen && (selected?.user_id != null || form.username.trim() !== "") && (
        <div className="grid gap-1.5">
          <Label htmlFor="tenant-edit-new-password">New password (optional)</Label>
          <Input id="tenant-edit-new-password" type="password" autoComplete="new-password" maxLength={200} value={form.new_password} onChange={e => setForm({ ...form, new_password: e.target.value })} />
          <p className="text-xs text-muted-foreground">Leave blank to keep the current password.</p>
        </div>
      )}
      <div className="grid gap-1.5">
        <Label htmlFor="tenant-profile-picture">Profile picture</Label>
        {!form.username.trim() ? (
          <p className="text-xs text-muted-foreground">Link a Tenant login to upload a profile picture.</p>
        ) : (
          <div className="flex items-center gap-3">
            {editOpen && selected?.profile_picture && getProfilePictureUrl(selected.profile_picture) && (
            <ImagePreview
              src={getProfilePictureUrl(selected.profile_picture)}
              alt="Current profile picture"
              triggerClassName="h-12 w-12 shrink-0 overflow-hidden rounded-full"
              imageClassName="h-full w-full object-cover"
            />
            )}
            <Input id="tenant-profile-picture" type="file" accept="image/jpeg,image/png,image/webp" onChange={e => {
              const file = e.target.files?.[0] ?? null;
              if (file && !validPicture(file)) {
                toast({ title: "Choose a JPG, PNG, or WEBP image up to 10MB", variant: "destructive" });
                e.target.value = "";
                return;
              }
              setTenantPicture(file);
            }} />
          </div>
        )}
        {form.username.trim() && <p className="text-xs text-muted-foreground">JPG, PNG, or WEBP up to 10MB.</p>}
      </div>
    </div>
  );

  return (
    <DashboardLayout role="admin">
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold">Tenants Management</h1>
            <p className="text-muted-foreground text-sm mt-1">Manage tenant accounts, room assignments, and tenancy details.</p>
          </div>
          <Button onClick={openAdd} className="gap-2"><Plus size={16} /> Add Tenant</Button>
        </div>
        {error && <div className="p-3 rounded-md border border-destructive/30 bg-destructive/10 text-destructive text-xs">{error}</div>}

        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, username, or room..." className="pl-10" />
          </div>
          <div className="flex shrink-0 gap-2" role="group" aria-label="Tenant view">
            <Button type="button" variant={view === "cards" ? "default" : "outline"} size="icon" aria-label="Card view" aria-pressed={view === "cards"} onClick={() => setView("cards")}>
              <LayoutGrid size={16} aria-hidden="true" />
            </Button>
            <Button type="button" variant={view === "table" ? "default" : "outline"} size="icon" aria-label="Table view" aria-pressed={view === "table"} onClick={() => setView("table")}>
              <Table2 size={16} aria-hidden="true" />
            </Button>
          </div>
        </div>

        {!tenants && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 size={14} className="animate-spin" /> Loading…</div>}
        {tenants && filtered.length === 0 && <div className="p-8 text-center text-muted-foreground bg-card border border-border rounded-lg">No tenants.</div>}

        {view === "cards" ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((t) => (
            <div key={t.tenant_id} className="bg-card border border-border rounded-lg p-5 space-y-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold text-sm overflow-hidden">
                    {t.user_id != null && getProfilePictureUrl(t.profile_picture) ? (
                      <ImagePreview
                        src={getProfilePictureUrl(t.profile_picture)}
                        alt={`${t.full_name} profile picture`}
                        triggerClassName="h-full w-full rounded-full"
                        imageClassName="h-full w-full object-cover"
                      />
                    ) : <UserRound size={18} />}
                  </div>
                  <div>
                    <p className="font-medium text-sm">{t.full_name}</p>
                    <p className="text-xs text-muted-foreground">@{t.username || "unknown"}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {t.room_number ? `Room ${t.room_number} · ${t.room_type}` : "No room assigned"}
                    </p>
                  </div>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal size={16} /></Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => openEdit(t)} className="gap-2"><Pencil size={14} /> Edit</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleDeactivate(t)} className="gap-2"><UserX size={14} /> Deactivate</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => { setSelected(t); setDelOpen(true); }} className="gap-2 text-destructive"><Trash2 size={14} /> Delete</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <div className="space-y-1 text-xs text-muted-foreground">
                <div className="flex items-center gap-2"><Mail size={12} /> {t.email}</div>
                <div className="flex items-center gap-2"><Phone size={12} /> {t.phone || "—"}</div>
                <div><span className="font-medium text-foreground">Address:</span> {t.address || "—"}</div>
                <div>
                  <span className="font-medium text-foreground">Birthday / Age:</span>{" "}
                  {t.birthday || "—"} / {t.age ?? "—"}
                </div>
                <div>
                  <span className="font-medium text-foreground">Emergency contact:</span>{" "}
                  {t.emergency_contact_name || "—"} · {t.emergency_contact_phone || "—"}
                </div>
              </div>


              <div className="flex items-center justify-between pt-2 border-t border-border">
                <Badge variant={t.is_active ? "default" : "secondary"} className="text-xs">
                  {t.is_active ? "Active" : "Inactive"}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {t.move_in_date}{t.move_out_date ? ` – ${t.move_out_date}` : ""}
                </span>
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
                  <TableHead>Room</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Address</TableHead>
                  <TableHead>Birthday / Age</TableHead>
                  <TableHead>Emergency Contact</TableHead>
                  <TableHead>Stay</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((t) => (
                  <TableRow key={t.tenant_id}>
                    <TableCell>
                      <div className="flex items-center gap-3 min-w-44">
                        <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center text-primary overflow-hidden shrink-0">
                          {t.user_id != null && getProfilePictureUrl(t.profile_picture) ? (
                            <ImagePreview
                              src={getProfilePictureUrl(t.profile_picture)}
                              alt={`${t.full_name} profile picture`}
                              triggerClassName="h-full w-full rounded-full"
                              imageClassName="h-full w-full object-cover"
                            />
                          ) : <UserRound size={16} />}
                        </div>
                        <div>
                          <p className="font-medium">{t.full_name}</p>
                          <p className="text-xs text-muted-foreground">@{t.username || "unknown"}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{t.room_number ? `Room ${t.room_number} · ${t.room_type}` : "No room assigned"}</TableCell>
                    <TableCell className="min-w-48">
                      <p>{t.email}</p>
                      <p className="text-xs text-muted-foreground">{t.phone || "—"}</p>
                    </TableCell>
                    <TableCell className="min-w-40">{t.address || "—"}</TableCell>
                    <TableCell className="whitespace-nowrap">{t.birthday || "—"} / {t.age ?? "—"}</TableCell>
                    <TableCell className="min-w-44">
                      <p>{t.emergency_contact_name || "—"}</p>
                      <p className="text-xs text-muted-foreground">{t.emergency_contact_phone || "—"}</p>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{t.move_in_date}{t.move_out_date ? ` – ${t.move_out_date}` : ""}</TableCell>
                    <TableCell><Badge variant={t.is_active ? "default" : "secondary"}>{t.is_active ? "Active" : "Inactive"}</Badge></TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Actions for ${t.full_name}`}>
                            <MoreHorizontal size={16} />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEdit(t)} className="gap-2"><Pencil size={14} /> Edit</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleDeactivate(t)} className="gap-2"><UserX size={14} /> Deactivate</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => { setSelected(t); setDelOpen(true); }} className="gap-2 text-destructive"><Trash2 size={14} /> Delete</DropdownMenuItem>
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
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Add Tenant</DialogTitle><DialogDescription>Create a new tenant record.</DialogDescription></DialogHeader>
          {fields}
          <DialogFooter>
            <Button variant="secondary" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={handleAdd} disabled={saving}>{saving ? "Saving…" : "Add"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Edit Tenant</DialogTitle><DialogDescription>Update tenant info.</DialogDescription></DialogHeader>
          {fields}
          <DialogFooter>
            <Button variant="secondary" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={handleEdit} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={delOpen} onOpenChange={setDelOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete tenant?</AlertDialogTitle>
            <AlertDialogDescription>This permanently removes {selected?.full_name}.</AlertDialogDescription>
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

export default AdminTenants;
