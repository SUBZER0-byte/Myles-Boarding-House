import { DashboardLayout } from "@/components/DashboardLayout";
import { Megaphone, Loader2 } from "lucide-react";
import { usePublicAnnouncements } from "@/hooks/usePublicInfo";

const TenantAnnouncements = () => {
  const { announcements, error, loading } = usePublicAnnouncements(5000);
  const data = announcements ?? [];

  return (
    <DashboardLayout role="tenant">
      <div className="space-y-6">
        <div>
          <h1 className="font-display text-2xl font-bold">Announcements</h1>
        </div>
        {error && <div className="p-3 rounded-md border border-destructive/30 bg-destructive/10 text-destructive text-xs">Could not load announcements: {error.message}</div>}
        {loading && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 size={14} className="animate-spin" /> Loading…</div>}
        {!loading && !error && data.length === 0 && <p className="text-sm text-muted-foreground">No announcements yet.</p>}
        <div className="space-y-3">
          {data.map((a) => (
            <div key={a.announcement_id} className="bg-card border border-border rounded-lg p-5">
              <div className="flex items-center gap-2 mb-1">
                <Megaphone size={14} className="text-primary" />
                <span className="text-xs text-muted-foreground">{new Date(a.created_at).toLocaleString()}</span>
              </div>
              <p className="font-medium">{a.title}</p>
              <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">{a.body}</p>
            </div>
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
};

export default TenantAnnouncements;
