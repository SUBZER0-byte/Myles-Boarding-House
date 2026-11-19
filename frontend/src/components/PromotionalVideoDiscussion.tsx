import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/lib/AuthProvider";
import { filterProfanity } from "@/lib/profanityFilter";
import {
  addPromotionalVideoComment,
  addPromotionalVideoReply,
  deleteMyPromotionalVideoComment,
  deleteMyPromotionalVideoReply,
  getPromotionalVideoDiscussion,
  togglePromotionalVideoDiscussionLike,
  togglePromotionalVideoLike,
  updateMyPromotionalVideoComment,
  updateMyPromotionalVideoReply,
  type PromotionalVideoDiscussion as Discussion,
} from "@/lib/promotionalVideo";
import { getYoutubeEmbedUrl } from "@/lib/promotionalVideoUrls";
import { ChevronDown, ChevronUp, Heart, Loader2, MessageCircle, Pencil, Send, ThumbsUp, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

export function PromotionalVideoDiscussion() {
  const { profile, loading: authLoading } = useAuth();
  const [discussion, setDiscussion] = useState<Discussion | null>(null);
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingComment, setSavingComment] = useState(false);
  const [savingLike, setSavingLike] = useState(false);
  const [savingDiscussionLikeTarget, setSavingDiscussionLikeTarget] = useState<string | null>(null);
  const [expandedReplies, setExpandedReplies] = useState<Set<number>>(() => new Set());
  const [replyingToId, setReplyingToId] = useState<number | null>(null);
  const [replyText, setReplyText] = useState("");
  const [savingReply, setSavingReply] = useState(false);
  const [editingReplyId, setEditingReplyId] = useState<number | null>(null);
  const [editingReply, setEditingReply] = useState("");
  const [savingReplyEdit, setSavingReplyEdit] = useState(false);
  const [deleteReplyId, setDeleteReplyId] = useState<number | null>(null);
  const [deletingReply, setDeletingReply] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState<number | null>(null);
  const [editingComment, setEditingComment] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [deleteCommentId, setDeleteCommentId] = useState<number | null>(null);
  const [deletingComment, setDeletingComment] = useState(false);
  const [error, setError] = useState("");
  const videoEmbedUrl = getYoutubeEmbedUrl(
    discussion?.video_url ?? "https://www.youtube.com/watch?v=KitgNbL8I4A",
  );

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

  const saveCommentEdit = async () => {
    if (editingCommentId === null || !editingComment.trim()) return;
    setSavingEdit(true);
    setError("");
    try {
      await updateMyPromotionalVideoComment(editingCommentId, editingComment);
      setEditingCommentId(null);
      setEditingComment("");
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update your comment.");
    } finally {
      setSavingEdit(false);
    }
  };

  const removeComment = async () => {
    if (deleteCommentId === null) return;
    setDeletingComment(true);
    setError("");
    try {
      await deleteMyPromotionalVideoComment(deleteCommentId);
      setDeleteCommentId(null);
      setEditingCommentId(null);
      setEditingComment("");
      setDeleteReplyId(null);
      setEditingReplyId(null);
      setEditingReply("");
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete your comment.");
    } finally {
      setDeletingComment(false);
    }
  };

  const toggleReplies = (commentId: number) => {
    setExpandedReplies(current => {
      const next = new Set(current);
      if (next.has(commentId)) next.delete(commentId);
      else next.add(commentId);
      return next;
    });
  };

  const submitReply = async (commentId: number) => {
    if (!profile || !replyText.trim()) return;
    setSavingReply(true);
    setError("");
    try {
      await addPromotionalVideoReply(commentId, replyText);
      setReplyText("");
      setReplyingToId(null);
      setExpandedReplies(current => new Set(current).add(commentId));
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not post your reply.");
    } finally {
      setSavingReply(false);
    }
  };

  const saveReplyEdit = async () => {
    if (editingReplyId === null || !editingReply.trim()) return;
    setSavingReplyEdit(true);
    setError("");
    try {
      await updateMyPromotionalVideoReply(editingReplyId, editingReply);
      setEditingReplyId(null);
      setEditingReply("");
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update your reply.");
    } finally {
      setSavingReplyEdit(false);
    }
  };

  const removeReply = async () => {
    if (deleteReplyId === null) return;
    setDeletingReply(true);
    setError("");
    try {
      await deleteMyPromotionalVideoReply(deleteReplyId);
      setDeleteReplyId(null);
      if (editingReplyId === deleteReplyId) {
        setEditingReplyId(null);
        setEditingReply("");
      }
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete your reply.");
    } finally {
      setDeletingReply(false);
    }
  };

  const toggleDiscussionLike = async (
    targetType: "comment" | "reply",
    targetId: number,
  ) => {
    if (!profile) return;
    const targetKey = `${targetType}-${targetId}`;
    setSavingDiscussionLikeTarget(targetKey);
    setError("");
    try {
      await togglePromotionalVideoDiscussionLike(targetType, targetId);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update your like.");
    } finally {
      setSavingDiscussionLikeTarget(null);
    }
  };

  const renderDiscussionLikeButton = (
    targetType: "comment" | "reply",
    targetId: number,
    likesCount: number,
    likedByMe: boolean,
  ) => {
    const targetKey = `${targetType}-${targetId}`;
    return (
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant={likedByMe ? "secondary" : "ghost"}
          aria-label={`${likedByMe ? "Unlike" : "Like"} ${targetType} (${likesCount})`}
          aria-pressed={likedByMe}
          disabled={!profile || savingDiscussionLikeTarget === targetKey}
          onClick={() => void toggleDiscussionLike(targetType, targetId)}
        >
          <ThumbsUp size={14} />
          {likedByMe ? "Liked" : "Like"}
          <span>{likesCount}</span>
        </Button>
        {!profile && (
          <Link
            className="text-xs font-medium text-primary underline-offset-4 hover:underline"
            to="/login"
            state={{ returnTo: "/#promotional-video" }}
          >
            Sign in to like
          </Link>
        )}
      </div>
    );
  };

  return (
    <section id="promotional-video" className="flex w-full flex-col items-center gap-6 px-6 py-12">
      {videoEmbedUrl ? (
        <iframe
          src={videoEmbedUrl}
          title="Myle's Boarding House promotional video"
          className="aspect-video w-full max-w-[720px] rounded-lg border border-border"
          allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
        />
      ) : (
        <p role="alert" className="w-full max-w-[720px] rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          The promotional video URL is invalid. Please contact an administrator.
        </p>
      )}
      <div className="w-full max-w-[720px] rounded-lg border border-border bg-card p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <MessageCircle size={18} className="text-primary" />
            <span>Discussion</span>
            <span className="text-muted-foreground">
              ({discussion?.comments_count ?? 0})
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
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <p className="text-sm font-semibold">{item.full_name}</p>
                    <time className="text-xs text-muted-foreground" dateTime={item.created_at}>
                      {new Date(item.created_at).toLocaleString()}
                    </time>
                  </div>
                  {profile && item.is_mine && (
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        aria-label="Edit my comment"
                        onClick={() => {
                          setEditingCommentId(item.comment_id);
                          setEditingComment(item.comment);
                          setError("");
                        }}
                      >
                        <Pencil size={14} />
                        Edit
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        aria-label="Delete my comment"
                        onClick={() => setDeleteCommentId(item.comment_id)}
                      >
                        <Trash2 size={14} />
                        Delete
                      </Button>
                    </div>
                  )}
                </div>
                {editingCommentId === item.comment_id ? (
                  <div className="mt-2 space-y-2">
                    <Textarea
                      aria-label="Edit comment"
                      value={editingComment}
                      onChange={event => setEditingComment(event.target.value)}
                      maxLength={1000}
                      rows={3}
                    />
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs text-muted-foreground">{editingComment.length}/1,000</span>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => {
                            setEditingCommentId(null);
                            setEditingComment("");
                          }}
                          disabled={savingEdit}
                        >
                          Cancel
                        </Button>
                        <Button
                          type="button"
                          onClick={() => void saveCommentEdit()}
                          disabled={savingEdit || !editingComment.trim()}
                        >
                          {savingEdit ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                          Save changes
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm">{filterProfanity(item.comment)}</p>
                )}
                <div className="mt-2">
                  {renderDiscussionLikeButton("comment", item.comment_id, item.likes_count, item.liked_by_me)}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
                  {item.replies_count > 0 && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      aria-expanded={expandedReplies.has(item.comment_id)}
                      onClick={() => toggleReplies(item.comment_id)}
                    >
                      {expandedReplies.has(item.comment_id)
                        ? <ChevronUp size={14} />
                        : <ChevronDown size={14} />}
                      {expandedReplies.has(item.comment_id) ? "Hide replies" : `Show replies (${item.replies_count})`}
                    </Button>
                  )}
                  {!item.is_mine && (
                    profile ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setReplyingToId(current => current === item.comment_id ? null : item.comment_id);
                          setReplyText("");
                          setExpandedReplies(current => new Set(current).add(item.comment_id));
                          setError("");
                        }}
                      >
                        <MessageCircle size={14} />
                        {replyingToId === item.comment_id ? "Cancel reply" : "Reply"}
                      </Button>
                    ) : (
                      <Link
                        className="text-sm font-medium text-primary underline-offset-4 hover:underline"
                        to="/login"
                        state={{ returnTo: "/#promotional-video" }}
                      >
                        Sign in to reply
                      </Link>
                    )
                  )}
                </div>
                {expandedReplies.has(item.comment_id) && (
                  <div className="ml-3 mt-2 space-y-3 border-l-2 border-border pl-3 sm:ml-5 sm:pl-4">
                    {item.replies.map(reply => (
                      <div key={reply.reply_id} className="rounded-md bg-background/70 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <p className="text-sm font-semibold">{reply.full_name}</p>
                            <time className="text-xs text-muted-foreground" dateTime={reply.created_at}>
                              {new Date(reply.created_at).toLocaleString()}
                            </time>
                          </div>
                          {profile && reply.is_mine && (
                            <div className="flex items-center gap-1">
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                aria-label="Edit my reply"
                                onClick={() => {
                                  setEditingReplyId(reply.reply_id);
                                  setEditingReply(reply.reply);
                                  setError("");
                                }}
                              >
                                <Pencil size={14} />
                                Edit
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="text-destructive"
                                aria-label="Delete my reply"
                                onClick={() => setDeleteReplyId(reply.reply_id)}
                              >
                                <Trash2 size={14} />
                                Delete
                              </Button>
                            </div>
                          )}
                        </div>
                        {editingReplyId === reply.reply_id ? (
                          <div className="mt-2 space-y-2">
                            <Textarea
                              aria-label="Edit reply"
                              value={editingReply}
                              onChange={event => setEditingReply(event.target.value)}
                              maxLength={1000}
                              rows={2}
                            />
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-xs text-muted-foreground">{editingReply.length}/1,000</span>
                              <div className="flex gap-2">
                                <Button
                                  type="button"
                                  variant="outline"
                                  onClick={() => {
                                    setEditingReplyId(null);
                                    setEditingReply("");
                                  }}
                                  disabled={savingReplyEdit}
                                >
                                  Cancel
                                </Button>
                                <Button
                                  type="button"
                                  onClick={() => void saveReplyEdit()}
                                  disabled={savingReplyEdit || !editingReply.trim()}
                                >
                                  {savingReplyEdit ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                                  Save changes
                                </Button>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <p className="mt-1 whitespace-pre-wrap break-words text-sm">{filterProfanity(reply.reply)}</p>
                        )}
                        <div className="mt-2">
                          {renderDiscussionLikeButton("reply", reply.reply_id, reply.likes_count, reply.liked_by_me)}
                        </div>
                      </div>
                    ))}
                    {item.replies_count > item.replies.length && (
                      <p className="text-xs text-muted-foreground">
                        Showing the latest {item.replies.length} of {item.replies_count} replies.
                      </p>
                    )}
                    {replyingToId === item.comment_id && (
                      <div className="space-y-2">
                        <label htmlFor={`promotional-video-reply-${item.comment_id}`} className="text-sm font-medium">
                          Reply to {item.full_name}
                        </label>
                        <Textarea
                          id={`promotional-video-reply-${item.comment_id}`}
                          value={replyText}
                          onChange={event => setReplyText(event.target.value)}
                          placeholder="Write a reply…"
                          maxLength={1000}
                          rows={2}
                        />
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-xs text-muted-foreground">{replyText.length}/1,000</span>
                          <Button
                            type="button"
                            onClick={() => void submitReply(item.comment_id)}
                            disabled={savingReply || !replyText.trim()}
                          >
                            {savingReply ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                            Post reply
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </article>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">
              {discussion ? "No comments yet. Be the first to share your thoughts!" : "Comments are currently unavailable."}
            </p>
          )}
        </div>
      </div>
      <AlertDialog
        open={deleteCommentId !== null}
        onOpenChange={open => !open && !deletingComment && setDeleteCommentId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete your comment?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes your comment from the promotional video discussion.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingComment}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={event => {
                event.preventDefault();
                void removeComment();
              }}
              disabled={deletingComment}
            >
              {deletingComment ? <Loader2 size={16} className="animate-spin" /> : "Delete comment"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={deleteReplyId !== null}
        onOpenChange={open => !open && !deletingReply && setDeleteReplyId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete your reply?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes your reply from the promotional video discussion.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingReply}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={event => {
                event.preventDefault();
                void removeReply();
              }}
              disabled={deletingReply}
            >
              {deletingReply ? <Loader2 size={16} className="animate-spin" /> : "Delete reply"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
