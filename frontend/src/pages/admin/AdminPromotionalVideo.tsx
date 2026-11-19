import { DashboardLayout } from "@/components/DashboardLayout";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  deleteAdminPromotionalVideoComment,
  deleteAdminPromotionalVideoLike,
  deleteAdminPromotionalVideoReply,
  listAdminPromotionalVideo,
  saveAdminPromotionalVideoUrl,
  type PromotionalVideoAdminData,
} from "@/lib/promotionalVideo";
import { getYoutubeEmbedUrl, getYoutubeVideoId } from "@/lib/promotionalVideoUrls";
import { useSupabasePolling } from "@/hooks/useSupabasePolling";
import { Heart, Loader2, MessageCircle, RefreshCw, Save, ThumbsUp, Trash2, Video } from "lucide-react";
import { useEffect, useState } from "react";

type RemovalTarget =
  | { kind: "comment"; id: number; label: string }
  | { kind: "reply"; id: number; label: string }
  | { kind: "like"; id: number; label: string };

const AdminPromotionalVideo = () => {
  const { toast } = useToast();
  const { data, loading, error: loadError, refetch } = useSupabasePolling<PromotionalVideoAdminData>(
    listAdminPromotionalVideo,
    5000,
  );
  const [videoUrl, setVideoUrl] = useState("");
  const [videoUrlDirty, setVideoUrlDirty] = useState(false);
  const [savingUrl, setSavingUrl] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removalTarget, setRemovalTarget] = useState<RemovalTarget | null>(null);
  const previewUrl = getYoutubeEmbedUrl(videoUrl);
  const storedVideoUrl = data?.video_url;

  useEffect(() => {
    if (storedVideoUrl !== undefined && !videoUrlDirty) {
      setVideoUrl(storedVideoUrl);
    }
  }, [storedVideoUrl, videoUrlDirty]);

  const saveVideoUrl = async () => {
    if (!getYoutubeVideoId(videoUrl)) {
      toast({
        title: "Enter a valid YouTube URL",
        description: "Use a YouTube watch, share, Shorts, or embed link.",
        variant: "destructive",
      });
      return;
    }

    setSavingUrl(true);
    try {
      const message = await saveAdminPromotionalVideoUrl(videoUrl);
      toast({ title: message });
      await refetch();
      setVideoUrlDirty(false);
    } catch (error) {
      toast({
        title: "Could not save promotional video URL",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSavingUrl(false);
    }
  };

  const confirmRemoval = async () => {
    if (!removalTarget) return;
    setRemoving(true);
    try {
      const message = removalTarget.kind === "comment"
        ? await deleteAdminPromotionalVideoComment(removalTarget.id)
        : removalTarget.kind === "reply"
          ? await deleteAdminPromotionalVideoReply(removalTarget.id)
          : await deleteAdminPromotionalVideoLike(removalTarget.id);
      toast({ title: message });
      setRemovalTarget(null);
      await refetch();
    } catch (error) {
      toast({
        title: removalTarget.kind === "comment"
          ? "Could not delete comment"
          : removalTarget.kind === "reply"
            ? "Could not delete reply"
            : "Could not remove like",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setRemoving(false);
    }
  };

  return (
    <DashboardLayout role="admin">
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold">Promotional Video</h1>
          </div>
          <Button type="button" variant="outline" onClick={() => void refetch()} disabled={loading}>
            {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            Refresh
          </Button>
        </div>

        {loadError && (
          <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {loadError}
          </p>
        )}

        <section className="space-y-4 rounded-lg border border-border bg-card p-4 sm:p-6">
          <div className="flex items-center gap-2">
            <Video size={20} className="text-primary" />
            <h2 className="font-semibold">Video URL and preview</h2>
          </div>
          <div className="space-y-2">
            <Label htmlFor="promotional-video-url">YouTube video URL</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="promotional-video-url"
                type="url"
                value={videoUrl}
                onChange={event => {
                  setVideoUrl(event.target.value);
                  setVideoUrlDirty(true);
                }}
                placeholder="https://www.youtube.com/watch?v=..."
                maxLength={2048}
              />
              <Button type="button" onClick={saveVideoUrl} disabled={savingUrl || loading || !videoUrl.trim()}>
                {savingUrl ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                Save video
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Paste a YouTube watch, youtu.be, Shorts, or embed URL. Saving updates the landing page.
            </p>
          </div>
          {previewUrl ? (
            <iframe
              src={previewUrl}
              title="Promotional video preview"
              className="aspect-video w-full max-w-[720px] rounded-lg border border-border"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
            />
          ) : (
            <p className="rounded-md border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
              Enter a supported YouTube URL to preview the video here.
            </p>
          )}
        </section>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <MessageCircle size={18} className="text-primary" />
              Comments
            </div>
            <p className="mt-2 font-display text-3xl font-bold">{data?.comments.length ?? 0}</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <MessageCircle size={18} className="text-primary" />
              Replies
            </div>
            <p className="mt-2 font-display text-3xl font-bold">{data?.replies.length ?? 0}</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Heart size={18} className="text-primary" />
              Likes
            </div>
            <p className="mt-2 font-display text-3xl font-bold">{data?.likes.length ?? 0}</p>
          </div>
        </div>

        <section className="space-y-3">
          <div>
            <h2 className="font-semibold">Video comments</h2>
            <p className="text-xs text-muted-foreground">Remove comments that should no longer appear publicly.</p>
          </div>
          {loading && !data ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 size={15} className="animate-spin" /> Loading comments…
            </p>
          ) : data?.comments.length ? (
            data.comments.map(comment => (
              <article key={comment.comment_id} className="flex items-start gap-3 rounded-lg border border-border bg-card p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <p className="text-sm font-semibold">{comment.full_name}</p>
                    <span className="text-xs text-muted-foreground">@{comment.username}</span>
                    <time className="text-xs text-muted-foreground" dateTime={comment.created_at}>
                      {new Date(comment.created_at).toLocaleString()}
                    </time>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap break-words text-sm">{comment.comment}</p>
                  <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                    <ThumbsUp size={14} aria-hidden="true" />
                    {comment.likes_count} {comment.likes_count === 1 ? "like" : "likes"}
                  </p>
                </div>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="shrink-0 text-destructive"
                  aria-label={`Delete comment by ${comment.full_name}`}
                  onClick={() => setRemovalTarget({
                    kind: "comment",
                    id: comment.comment_id,
                    label: `comment by ${comment.full_name}`,
                  })}
                >
                  <Trash2 size={16} />
                </Button>
              </article>
            ))
          ) : (
            <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
              {loadError ? "Comments could not be loaded." : "No comments yet."}
            </p>
          )}
        </section>

        <section className="space-y-3">
          <div>
            <h2 className="font-semibold">Video replies</h2>
            <p className="text-xs text-muted-foreground">Review replies in context and remove replies that should no longer appear publicly.</p>
          </div>
          {loading && !data ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 size={15} className="animate-spin" /> Loading replies…
            </p>
          ) : data?.replies.length ? (
            data.replies.map(reply => (
              <article key={reply.reply_id} className="flex items-start gap-3 rounded-lg border border-border bg-card p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <p className="text-sm font-semibold">{reply.full_name}</p>
                    <span className="text-xs text-muted-foreground">@{reply.username}</span>
                    <time className="text-xs text-muted-foreground" dateTime={reply.created_at}>
                      {new Date(reply.created_at).toLocaleString()}
                    </time>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Reply to {reply.commenter_name}: “{reply.comment}”
                  </p>
                  <p className="mt-2 whitespace-pre-wrap break-words text-sm">{reply.reply}</p>
                  <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                    <ThumbsUp size={14} aria-hidden="true" />
                    {reply.likes_count} {reply.likes_count === 1 ? "like" : "likes"}
                  </p>
                </div>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="shrink-0 text-destructive"
                  aria-label={`Delete reply by ${reply.full_name}`}
                  onClick={() => setRemovalTarget({
                    kind: "reply",
                    id: reply.reply_id,
                    label: `reply by ${reply.full_name}`,
                  })}
                >
                  <Trash2 size={16} />
                </Button>
              </article>
            ))
          ) : (
            <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
              {loadError ? "Replies could not be loaded." : "No replies yet."}
            </p>
          )}
        </section>

        <section className="space-y-3">
          <div>
            <h2 className="font-semibold">Video likes</h2>
            <p className="text-xs text-muted-foreground">Review accounts that liked the video or remove a like.</p>
          </div>
          {loading && !data ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 size={15} className="animate-spin" /> Loading likes…
            </p>
          ) : data?.likes.length ? (
            <div className="divide-y divide-border rounded-lg border border-border bg-card">
              {data.likes.map(like => (
                <div key={like.user_id} className="flex items-center gap-3 p-4">
                  <Heart size={16} className="shrink-0 text-primary" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{like.full_name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      @{like.username} · {new Date(like.created_at).toLocaleString()}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="shrink-0 text-destructive"
                    aria-label={`Remove like by ${like.full_name}`}
                    onClick={() => setRemovalTarget({
                      kind: "like",
                      id: like.user_id,
                      label: `like by ${like.full_name}`,
                    })}
                  >
                    <Trash2 size={16} />
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
              {loadError ? "Likes could not be loaded." : "No likes yet."}
            </p>
          )}
        </section>
      </div>

      <AlertDialog open={Boolean(removalTarget)} onOpenChange={open => !open && !removing && setRemovalTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {removalTarget?.kind === "comment"
                ? "Delete this comment?"
                : removalTarget?.kind === "reply"
                  ? "Delete this reply?"
                  : "Remove this like?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the {removalTarget?.label} from the promotional video.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={event => {
                event.preventDefault();
                void confirmRemoval();
              }}
              disabled={removing}
            >
              {removing ? <Loader2 size={16} className="animate-spin" /> : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
};

export default AdminPromotionalVideo;
