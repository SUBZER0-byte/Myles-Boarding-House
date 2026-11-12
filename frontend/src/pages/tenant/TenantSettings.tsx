import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { ProfilePictureCard } from "@/components/ProfilePictureCard";
import { useCallback, useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { usePolling } from "@/hooks/usePolling";
import { api, endpoints, sessionStore, type ApiResponse } from "@/lib/api";

interface Profile {
  user_id: number; full_name: string; username: string; email: string; phone: string;
  address: string | null; age: number | string | null; birthday: string | null;
  user_type: string; tenant_id?: number; move_in_date?: string; room_number?: string;
  profile_picture?: string | null;
  emergency_contact_name: string | null; emergency_contact_phone: string | null;
}

const TenantSettings = () => {
  const { toast } = useToast();
  const session = sessionStore.get();
  const userId = session?.user_id;
  const [profile, setProfile] = useState<Profile | null>(null);
  const [pw, setPw] = useState({ current_password: "", new_password: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [visiblePasswordFields, setVisiblePasswordFields] = useState({ current: false, next: false });

  const fetchProfile = useCallback(async () => {
    if (!userId) return;
    const res = await api.get<ApiResponse<Profile>>(`${endpoints.tenantSettings}?action=get_profile&user_id=${userId}`);
    if (res.data.type === "success" && res.data.data) setProfile(res.data.data);
    setLoading(false);
  }, [userId]);

  const { data: polledProfile, refetch: refetchProfileFromPoll } = usePolling<Profile>(
    userId ? `${endpoints.tenantSettings}?action=get_profile&user_id=${userId}` : null,
    { intervalMs: 5000 }
  );

  useEffect(() => {
    void fetchProfile();
  }, [fetchProfile]);

  useEffect(() => {
    if (polledProfile) {
      setProfile(polledProfile);
      setLoading(false);
    }
  }, [polledProfile]);
  const saveProfile = async () => {
    if (!profile) return;
    setSaving(true);
    const res = await api.post<ApiResponse>(`${endpoints.tenantSettings}?action=update_profile`, profile);
    toast({ title: res.data.message ?? "Saved" });
    setSaving(false);
    if (res.data.type === "success") {
      void refetchProfileFromPoll();
    }
  };

  const changePassword = async () => {
    if (!profile) return;
    const res = await api.post<ApiResponse>(`${endpoints.tenantSettings}?action=change_password`, { user_id: profile.user_id, ...pw });
    toast({ title: res.data.message ?? "Updated", variant: res.data.type === "success" ? "default" : "destructive" });
    if (res.data.type === "success") setPw({ current_password: "", new_password: "" });
  };

  if (!userId) return (
    <DashboardLayout role="tenant">
      <div className="p-4 rounded-md border border-warning/30 bg-warning/10 text-warning text-sm">Sign in to view settings.</div>
    </DashboardLayout>
  );
  if (loading || !profile) return (
    <DashboardLayout role="tenant">
      <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 size={14} className="animate-spin" /> Loading…</div>
    </DashboardLayout>
  );

  return (
    <DashboardLayout role="tenant">
      <div className="space-y-6 max-w-2xl">
        <h1 className="font-display text-2xl font-bold">Settings</h1>

        <ProfilePictureCard userId={profile.user_id} currentPath={profile.profile_picture} endpoint={`${endpoints.tenantSettings}?action=upload_profile_picture`} onUploaded={fetchProfile} />

        <div className="bg-card border border-border rounded-lg p-5 space-y-3">
          <h2 className="font-semibold">Profile</h2>
          <div className="grid gap-1.5"><Label>Username</Label>
            <Input value={profile.username} readOnly /></div>
          <div className="grid gap-1.5"><Label>Full name</Label>
            <Input value={profile.full_name} onChange={e => setProfile({ ...profile, full_name: e.target.value })} /></div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="grid gap-1.5"><Label>Email</Label>
              <Input value={profile.email} onChange={e => setProfile({ ...profile, email: e.target.value })} /></div>
            <div className="grid gap-1.5"><Label>Phone</Label>
              <Input
                type="tel"
                inputMode="numeric"
                maxLength={11}
                placeholder="09XXXXXXXXX"
                value={profile.phone ?? ""}
                onChange={e => setProfile({ ...profile, phone: e.target.value.replace(/\D/g, "").slice(0, 11) })}
              /></div>
          </div>
          <div className="grid gap-1.5"><Label>Address</Label>
            <Input maxLength={255} value={profile.address ?? ""} onChange={e => setProfile({ ...profile, address: e.target.value })} placeholder="Not provided" /></div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="grid gap-1.5"><Label>Birthday</Label>
              <Input type="date" value={profile.birthday ?? ""} onChange={e => setProfile({ ...profile, birthday: e.target.value })} /></div>
            <div className="grid gap-1.5"><Label>Age</Label>
              <Input type="number" min="0" max="120" value={profile.age ?? ""} onChange={e => setProfile({ ...profile, age: e.target.value })} placeholder="Not provided" /></div>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="grid gap-1.5"><Label>Emergency contact name</Label>
              <Input maxLength={150} value={profile.emergency_contact_name ?? ""} onChange={e => setProfile({ ...profile, emergency_contact_name: e.target.value })} /></div>
            <div className="grid gap-1.5"><Label>Emergency contact phone</Label>
              <Input type="tel" inputMode="numeric" maxLength={11} placeholder="09XXXXXXXXX" value={profile.emergency_contact_phone ?? ""} onChange={e => setProfile({ ...profile, emergency_contact_phone: e.target.value.replace(/\D/g, "").slice(0, 11) })} /></div>
          </div>
          <div className="grid sm:grid-cols-2 gap-3 pt-2">
            <div className="p-3 rounded-md bg-muted/50">
              <p className="text-xs text-muted-foreground">Room</p>
              <p className="font-medium">{profile.room_number ?? "—"}</p>
            </div>
            <div className="p-3 rounded-md bg-muted/50">
              <p className="text-xs text-muted-foreground">Move-in</p>
              <p className="font-medium">{profile.move_in_date ?? "—"}</p>
            </div>
          </div>
          <Button onClick={saveProfile} disabled={saving}>{saving ? "Saving…" : "Save Profile"}</Button>
        </div>

        <div className="bg-card border border-border rounded-lg p-5 space-y-3">
          <h2 className="font-semibold">Change Password</h2>
          <div className="grid gap-1.5"><Label htmlFor="tenant-current-password">Current</Label>
            <div className="flex gap-2">
              <Input id="tenant-current-password" type={visiblePasswordFields.current ? "text" : "password"} autoComplete="current-password" value={pw.current_password} onChange={e => setPw({ ...pw, current_password: e.target.value })} />
              <Button type="button" variant="outline" size="icon" aria-label={visiblePasswordFields.current ? "Hide current password" : "Show current password"} aria-pressed={visiblePasswordFields.current} onClick={() => setVisiblePasswordFields(current => ({ ...current, current: !current.current }))}>
                {visiblePasswordFields.current ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
              </Button>
            </div>
          </div>
          <div className="grid gap-1.5"><Label htmlFor="tenant-new-password">New (min 6 chars)</Label>
            <div className="flex gap-2">
              <Input id="tenant-new-password" type={visiblePasswordFields.next ? "text" : "password"} autoComplete="new-password" value={pw.new_password} onChange={e => setPw({ ...pw, new_password: e.target.value })} />
              <Button type="button" variant="outline" size="icon" aria-label={visiblePasswordFields.next ? "Hide new password" : "Show new password"} aria-pressed={visiblePasswordFields.next} onClick={() => setVisiblePasswordFields(current => ({ ...current, next: !current.next }))}>
                {visiblePasswordFields.next ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
              </Button>
            </div>
          </div>
          <Button onClick={changePassword}>Update Password</Button>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default TenantSettings;
