import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Loader2, UserRound } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { useTenantRatings } from "@/hooks/useTenantRatings";
import { submitTenantRating } from "@/lib/tenantRatings";
import { RatingStars } from "@/components/RatingStars";

const TenantRatings = () => {
  const { toast } = useToast();
  const { ratings, refetch, error, loading } = useTenantRatings();
  const [stars, setStars] = useState(5);
  const [category, setCategory] = useState("Overall Satisfaction");
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      await submitTenantRating({ stars, category, comment });
      toast({ title: "Feedback submitted for review" });
      setComment("");
      setStars(5);
      setCategory("Overall Satisfaction");
      void refetch();
    } catch (caught) {
      toast({
        title: caught instanceof Error ? caught.message : "Could not submit rating.",
        variant: "destructive",
      });
    } finally { setSaving(false); }
  };

  return (
    <DashboardLayout role="tenant">
      <div className="space-y-6">
        <div>
          <h1 className="font-display text-2xl font-bold">Ratings & Feedback</h1>
          <p className="text-muted-foreground text-sm mt-1">Tell us how we're doing.</p>
        </div>
        {error && <div className="p-3 rounded-md border border-destructive/30 bg-destructive/10 text-destructive text-xs">{error.message}</div>}

        <div className="bg-card border border-border rounded-lg p-5 space-y-3">
          <h2 className="font-semibold">New Rating</h2>
          <div>
            <RatingStars value={stars} size={28} onChange={setStars} />
            <p className="mt-1 text-sm text-muted-foreground">{stars.toFixed(1)} out of 5 stars</p>
          </div>
          <div className="grid gap-1.5">
            <Label>Feedback category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Facilities">Facilities</SelectItem>
                <SelectItem value="Services">Services</SelectItem>
                <SelectItem value="Overall Satisfaction">Overall Satisfaction</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Written feedback</Label>
            <Textarea rows={3} maxLength={3000} placeholder="Share your feedback…" value={comment} onChange={e => setComment(e.target.value)} />
          </div>
          <Button onClick={submit} disabled={saving || !comment.trim()}>{saving ? "Sending…" : "Submit Rating"}</Button>
        </div>

        <div className="bg-card border border-border rounded-lg p-5">
          <h2 className="font-semibold mb-3">My Past Ratings</h2>
          {loading && <Loader2 size={14} className="animate-spin" />}
          {!loading && !error && ratings?.length === 0 && <p className="text-sm text-muted-foreground">No ratings yet.</p>}
          <div className="space-y-3">
            {ratings?.map(r => (
              <div key={r.rating_id} className="p-3 rounded-md bg-muted/50 flex items-start gap-3">
                <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center overflow-hidden shrink-0">
                  <UserRound size={16} className="text-muted-foreground" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                  <RatingStars value={Number(r.stars)} size={12} />
                  <span className="text-xs text-muted-foreground">{Number(r.stars).toFixed(1)}</span>
                  <span className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString()}</span>
                  <Badge variant={r.moderation_status === "Approved" ? "default" : "secondary"} className="text-xs">{r.moderation_status}</Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{r.category}</p>
                {r.comment && <p className="text-sm mt-1">{r.comment}</p>}
                {r.admin_reply && <div className="mt-2 border-l-2 border-primary/40 pl-2 text-xs"><span className="font-medium">Admin reply:</span> {r.admin_reply}</div>}
              </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default TenantRatings;
