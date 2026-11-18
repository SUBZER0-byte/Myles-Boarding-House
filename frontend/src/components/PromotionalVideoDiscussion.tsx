import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/lib/AuthProvider";
import {
  addPromotionalVideoComment,
  getPromotionalVideoDiscussion,
  togglePromotionalVideoLike,
  type PromotionalVideoDiscussion as Discussion,
} from "@/lib/promotionalVideo";
import { Heart, Loader2, MessageCircle, Send } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

export function PromotionalVideoDiscussion() {
  const { profile, loading: authLoading } = useAuth();
  const [discussion, setDiscussion] = useState<Discussion | null>(null);
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingComment, setSavingComment] = useState(false);
  const [savingLike, setSavingLike] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const result = await getPromotionalVideoDiscussion();
      setDiscussion(result);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load video comments and likes.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const submitComment = async () => {
    if (!profile || !comment.trim()) return;
    setSavingComment(true);
    setError("");
    try {
      await addPromotionalVideoComment(comment);
      setComment("");
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not post your comment.");
    } finally {
      setSavingComment(false);
    }
  };

  const toggleLike = async () => {
    if (!profile) return;
    setSavingLike(true);
    setError("");
    try {
      const result = await togglePromotionalVideoLike();
      setDiscussion(current => current
        ? { ...current, ...result }
        : current);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update your like.");
    } finally {
      setSavingLike(false);
    }
  };

  return (
    <div className="w-full max-w-[720px] rounded-lg border border-border bg-card p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <MessageCircle size={18} className="text-primary" />
          <span>Discussion</span>
          <span className="text-muted-foreground">
            ({discussion?.comments.length ?? 0})
          </span>
        </div>
        <Button
          type="button"
          variant={discussion?.liked_by_me ? "default" : "outline"}
          size="sm"
          onClick={toggleLike}
          disabled={authLoading || !profile || savingLike || !discussion}
          aria-pressed={discussion?.liked_by_me ?? false}
          aria-label={profile ? (discussion?.liked_by_me ? "Unlike video" : "Like video") : "Sign in to like video"}
        >
          {savingLike ? <Loader2 size={16} className="animate-spin" /> : <Heart size={16} className={discussion?.liked_by_me ? "fill-current" : ""} />}
          <span>{discussion?.likes_count ?? 0} Likes</span>
        </Button>
      </div>

      {error && (
        <p role="alert" className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {authLoading ? (
        <p className="mt-4 text-sm text-muted-foreground">Checking sign-in status…</p>
      ) : profile ? (
        <div className="mt-4 space-y-2">
          <label htmlFor="promotional-video-comment" className="text-sm font-medium">Add a comment</label>
          <Textarea
            id="promotional-video-comment"
            value={comment}
            onChange={event => setComment(event.target.value)}
            placeholder="Share your thoughts about Myle's Boarding House…"
            maxLength={1000}
            rows={3}
          />
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">{comment.length}/1,000</span>
            <Button type="button" onClick={submitComment} disabled={savingComment || !comment.trim()}>
              {savingComment ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
              Post comment
            </Button>
          </div>
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">
          <Link
            className="font-medium text-primary underline-offset-4 hover:underline"
            to="/login"
            state={{ returnTo: "/#promotional-video" }}
          >
            Sign in
          </Link>
          {" "}to like the video or post a comment.
        </p>
      )}

      <div className="mt-5 space-y-3 border-t border-border pt-4">
        {loading && !discussion ? (
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 size={15} className="animate-spin" /> Loading comments…
          </p>
        ) : discussion?.comments.length ? (
          discussion.comments.map(item => (
            <article key={item.comment_id} className="rounded-md bg-muted/50 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold">{item.full_name}</p>
                <time className="text-xs text-muted-foreground" dateTime={item.created_at}>
                  {new Date(item.created_at).toLocaleString()}
                </time>
              </div>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm">{item.comment}</p>
            </article>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">
            {discussion ? "No comments yet. Be the first to share your thoughts!" : "Comments are currently unavailable."}
          </p>
        )}
      </div>
    </div>
  );
}
