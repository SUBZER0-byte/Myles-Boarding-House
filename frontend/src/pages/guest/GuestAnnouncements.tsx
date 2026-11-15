import { DashboardLayout } from "@/components/DashboardLayout";
import { Megaphone, Loader2 } from "lucide-react";
import { usePublicAnnouncements } from "@/hooks/usePublicInfo";

const GuestAnnouncements = () => {
  const { announcements, error, loading } = usePublicAnnouncements();
  const items = (announcements ?? []).slice(0, 5);

  return (
    <DashboardLayout role="guest">
      <div className="space-y-6">
        <div>
          <h1 className="font-display text-2xl font-bold">Announcements</h1>
          <p className="text-muted-foreground text-sm mt-1">Latest updates from Myle's Boarding House.</p>
        </div>

        {error && (
          <div className="p-3 rounded-md border border-destructive/30 bg-destructive/10 text-destructive text-xs">
            Could not load announcements: {error.message}
          </div>
        )}

        <div className="space-y-3">
          {loading && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 size={14} className="animate-spin" /> Loading…
            </div>
          )}
          {!loading && !error && items.length === 0 && (
            <p className="text-sm text-muted-foreground">No announcements yet.</p>
          )}
          {items.map((a) => (
            <div key={a.announcement_id} className="bg-card border border-border rounded-lg p-5">
              <div className="flex items-center gap-2 mb-2">
                <Megaphone size={14} className="text-muted-foreground" />
                <span className="text-xs text-muted-foreground">{new Date(a.created_at).toLocaleString()}</span>
              </div>
              <h3 className="font-display font-semibold mb-1">{a.title}</h3>
              <p className="text-sm text-muted-foreground whitespace-pre-line">{a.body}</p>
            </div>
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
};

export default GuestAnnouncements;
