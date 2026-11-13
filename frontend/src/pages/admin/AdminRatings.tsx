import { DashboardLayout } from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Trash2, Loader2, UserRound, Eye, EyeOff, Send } from "lucide-react";
import { useCallback, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { useSupabasePolling } from "@/hooks/useSupabasePolling";
import { getProfilePictureUrl } from "@/lib/profileSettings";
import { RatingStars } from "@/components/RatingStars";
import {
  deleteAdminRating,
  getAdminRatingCategorySummary,
  getAdminRatingSummary,
  listAdminRatings,
  moderateAdminRating,
  replyToAdminRating,
  type AdminRating,
  type AdminRatingSummary,
} from "@/lib/adminRatings";

const AdminRatings = () => {
  const { toast } = useToast();
  const loadRatings = useCallback(() => listAdminRatings(), []);
  const loadSummary = useCallback(() => getAdminRatingSummary(), []);
  const loadCategorySummary = useCallback(() => getAdminRatingCategorySummary(), []);
  const { data: ratings, refetch, error } = useSupabasePolling(loadRatings, 5000);
  const { data: summary, error: summaryError } = useSupabasePolling(loadSummary, 5000);
  const {
    data: categorySummary,
    refetch: refetchCategorySummary,
    error: categorySummaryError,
  } = useSupabasePolling(loadCategorySummary, 10000);
  const [replyOpen, setReplyOpen] = useState(false);
  const [selected, setSelected] = useState<AdminRating | null>(null);
  const [reply, setReply] = useState("");
  const [saving, setSaving] = useState(false);

  const remove = async (r: AdminRating) => {
    try {
      const message = await deleteAdminRating(r.rating_id);
      toast({ title: message });
      refetch();
      refetchCategorySummary();
    } catch (cause) {
      toast({
        title: "Could not delete rating",
        description: cause instanceof Error ? cause.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  const moderate = async (r: AdminRating, moderationStatus: "Approved" | "Hidden") => {
    try {
      const message = await moderateAdminRating(r.rating_id, moderationStatus);
      toast({ title: message });
      refetch();
      refetchCategorySummary();
    } catch (cause) {
      toast({
        title: "Could not update rating moderation",
        description: cause instanceof Error ? cause.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  const sendReply = async () => {
    if (!selected || !reply.trim()) return;
    setSaving(true);
    try {
      const message = await replyToAdminRating(selected.rating_id, reply);
      toast({ title: message });
      setReplyOpen(false);
      setReply("");
      setSelected(null);
      refetch();
    } catch (cause) {
      toast({
        title: "Could not send reply",
        description: cause instanceof Error ? cause.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <DashboardLayout role="admin">
      <div className="space-y-6">
        <div>
          <h1 className="font-display text-2xl font-bold">Ratings</h1>
          <p className="text-muted-foreground text-sm mt-1">Moderate tenant feedback about facilities, services, and overall satisfaction.</p>
        </div>
        {error && <div className="p-3 rounded-md border border-destructive/30 bg-destructive/10 text-destructive text-xs">{error}</div>}
        {summaryError && <div className="p-3 rounded-md border border-destructive/30 bg-destructive/10 text-destructive text-xs">{summaryError}</div>}
        {categorySummaryError && <div className="p-3 rounded-md border border-destructive/30 bg-destructive/10 text-destructive text-xs">{categorySummaryError}</div>}

        {summary && (
          <div className="grid sm:grid-cols-3 gap-4">
            <div className="bg-card border border-border rounded-lg p-5">
              <p className="text-xs text-muted-foreground">Average</p>
              <p className="font-display text-3xl font-bold mt-1">{Number(summary.average).toFixed(2)}</p>
              <div className="mt-2"><RatingStars value={Number(summary.average)} size={14} /></div>
            </div>
            <div className="bg-card border border-border rounded-lg p-5">
              <p className="text-xs text-muted-foreground">Total Ratings</p>
              <p className="font-display text-3xl font-bold mt-1">{summary.total}</p>
            </div>
            <div className="bg-card border border-border rounded-lg p-5 space-y-1">
              {[
                { label: "5", key: "five" },
                { label: "4.5", key: "four_half" },
                { label: "4", key: "four" },
                { label: "3.5", key: "three_half" },
                { label: "3", key: "three" },
                { label: "2.5", key: "two_half" },
                { label: "2", key: "two" },
                { label: "1.5", key: "one_half" },
                { label: "1", key: "one" },
              ].map(({ label, key }) => {
                const count = Number(summary[key as keyof AdminRatingSummary]);
                return (
                  <div key={key} className="flex items-center gap-2 text-xs">
                    <span className="w-6">{label}★</span>
                    <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-warning" style={{ width: `${summary.total ? (count / summary.total * 100) : 0}%` }} />
                    </div>
                    <span className="w-6 text-right text-muted-foreground">{count}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <section className="space-y-3">
          <div>
            <h2 className="font-semibold">Average rating by category</h2>
            <p className="text-xs text-muted-foreground">Only approved feedback is included.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {(categorySummary ?? []).map(item => (
              <div key={item.category} className="border border-border rounded-lg p-4 bg-card">
                <p className="text-sm font-medium">{item.category}</p>
                <div className="flex items-center gap-2 mt-2">
                  <RatingStars value={Number(item.average)} size={14} />
                  <span className="text-sm font-semibold">{Number(item.average).toFixed(2)}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{item.total} approved ratings</p>
              </div>
            ))}
          </div>
        </section>

        {!ratings && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 size={14} className="animate-spin" /> Loading…</div>}
        <div className="space-y-3">
          {ratings?.map((r) => (
            <div key={r.rating_id} className="bg-card border border-border rounded-lg p-4 flex items-start gap-3">
              <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center overflow-hidden shrink-0">
                {r.user_id && getProfilePictureUrl(r.profile_picture) ? <img src={getProfilePictureUrl(r.profile_picture)} alt={`${r.full_name ?? "User"} profile`} className="h-full w-full object-cover" /> : <UserRound size={18} className="text-muted-foreground" />}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-medium text-sm">{r.full_name ?? "Anonymous"}</p>
                  <RatingStars value={Number(r.stars)} size={12} />
                  <span className="text-xs text-muted-foreground">{Number(r.stars).toFixed(1)}</span>
                  <Badge variant={r.moderation_status === "Approved" ? "default" : r.moderation_status === "Hidden" ? "secondary" : "destructive"}>{r.moderation_status}</Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{r.category}</p>
                <p className="text-sm text-muted-foreground mt-1">{r.comment}</p>
                {r.admin_reply && <p className="text-xs mt-2"><span className="font-medium">Admin reply:</span> {r.admin_reply}</p>}
                <p className="text-xs text-muted-foreground mt-1">{new Date(r.created_at).toLocaleString()}</p>
              </div>
              <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={r.moderation_status === "Approved" ? "Hide feedback" : "Approve feedback"} onClick={() => moderate(r, r.moderation_status === "Approved" ? "Hidden" : "Approved")}>
                {r.moderation_status === "Approved" ? <EyeOff size={14} /> : <Eye size={14} />}
              </Button>
              <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Reply to feedback" onClick={() => { setSelected(r); setReply(r.admin_reply ?? ""); setReplyOpen(true); }}>
                <Send size={14} />
              </Button>
              <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => remove(r)}><Trash2 size={14} /></Button>
            </div>
          ))}
        </div>
      </div>
      <Dialog open={replyOpen} onOpenChange={setReplyOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reply to tenant feedback</DialogTitle>
            <DialogDescription>{selected?.category} · {selected?.full_name ?? "Tenant"}</DialogDescription>
          </DialogHeader>
          <Textarea rows={5} maxLength={3000} value={reply} onChange={event => setReply(event.target.value)} placeholder="Write a response…" />
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setReplyOpen(false)}>Cancel</Button>
            <Button type="button" onClick={sendReply} disabled={saving || !reply.trim()}>{saving ? "Sending…" : "Send Reply"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
};

export default AdminRatings;
