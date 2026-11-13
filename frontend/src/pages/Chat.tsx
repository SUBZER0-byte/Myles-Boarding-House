import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChatPolling } from "@/hooks/useChatPolling";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, ImagePlus, Send, Smile, Trash2, UserRound, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLocation } from "react-router-dom";
import { getProfilePictureUrl } from "@/lib/profileSettings";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { loadMyProfile, type AuthProfile } from "@/lib/auth";
import {
  listChatConversations,
  listChatMessages,
  removeChatMessage,
  sendChatMessage,
  type ChatConversation,
  type ChatMessage,
} from "@/lib/chatWorkflows";

const EmojiPicker = lazy(() => import("emoji-picker-react"));

export default function Chat() {
  const location = useLocation();
  const [authChecked, setAuthChecked] = useState(false);
  const [authUser, setAuthUser] = useState<AuthProfile | null>(null);
  const [authError, setAuthError] = useState("");
  const myId = Number(authUser?.user_id ?? 0);
  const pathRole = location.pathname.startsWith("/admin")
    ? "admin"
    : location.pathname.startsWith("/tenant")
      ? "tenant"
      : "guest";
  const role = location.pathname.startsWith("/guest")
    ? "guest"
    : String(authUser?.user_type ?? pathRole).toLowerCase();

  const [peerId, setPeerId] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [imageViewer, setImageViewer] = useState<{ urls: string[]; index: number } | null>(null);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [removingMessageId, setRemovingMessageId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const imagePreviewUrls = useMemo(
    () => imageFiles.map(file => URL.createObjectURL(file)),
    [imageFiles],
  );
  const openImageViewer = (urls: string[], index: number) => setImageViewer({ urls, index });
  const moveImageViewer = (offset: number) => {
    setImageViewer(current => current
      ? { ...current, index: (current.index + offset + current.urls.length) % current.urls.length }
      : current);
  };

  useEffect(() => () => {
    imagePreviewUrls.forEach(URL.revokeObjectURL);
  }, [imagePreviewUrls]);

  useEffect(() => {
    let alive = true;
    loadMyProfile().then(profile => {
      if (alive) {
        setAuthUser(profile);
        setAuthError("");
      }
    }).catch(profileError => {
      if (alive) setAuthError(profileError instanceof Error ? profileError.message : "Could not load your account.");
    }).finally(() => {
      if (alive) setAuthChecked(true);
    });
    return () => { alive = false; };
  }, []);

  const loadConversations = useCallback(() => listChatConversations(), []);
  const loadMessages = useCallback(
    () => peerId ? listChatMessages(peerId) : Promise.resolve([]),
    [peerId],
  );
  const {
    data: conversations,
    loading: conversationsLoading,
    error: conversationsError,
  } = useChatPolling<ChatConversation[]>(loadConversations, 3000, authChecked && !!authUser);
  const visibleConversations = useMemo(
    () => (conversations ?? []).filter((c) =>
      Number(c.user_id) !== myId && (role !== "guest" || c.user_type.toLowerCase() === "admin")
    ),
    [conversations, myId, role]
  );

  const { data: liveMessages, error: messagesError } = useChatPolling<ChatMessage[]>(
    loadMessages,
    3000,
    !!peerId && !!authUser,
  );

  useEffect(() => {
    setMessages(liveMessages ?? []);
  }, [liveMessages, peerId]);

  useEffect(() => {
    if (messagesError) setError(messagesError);
  }, [messagesError]);

  useEffect(() => {
    if (peerId === myId) {
      setPeerId(null);
      return;
    }
    if (!peerId && visibleConversations.length > 0) {
      setPeerId(visibleConversations[0].user_id);
    }
  }, [myId, peerId, visibleConversations]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, peerId]);

  const send = async () => {
    const body = draft.trim();
    if ((!body && !imageFiles.length) || !peerId || sending) return;
    if (!authUser) {
      setError("Please sign in to send messages.");
      return;
    }
    if (imageFiles.some(file => file.size > 30 * 1024 * 1024)) {
      setError("Each image must be smaller than 30 MB.");
      return;
    }
    if (imageFiles.length > 5) {
      setError("You can attach up to 5 images per message.");
      return;
    }
    if (imageFiles.reduce((total, file) => total + file.size, 0) > 150 * 1024 * 1024) {
      setError("Selected images must total less than 150 MB.");
      return;
    }
    setError("");
    setSending(true);
    try {
      const message = await sendChatMessage(peerId, body, imageFiles);
      setMessages(previous =>
        previous.some(item => item.message_id === message.message_id)
          ? previous
          : [...previous, message]
      );
      setDraft("");
      setImageFiles([]);
      if (imageInputRef.current) imageInputRef.current.value = "";
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Unable to send message right now.");
    } finally {
      setSending(false);
    }
  };

  const removeMessage = async (message: ChatMessage, mode: "delete_for_me" | "unsend") => {
    if (removingMessageId !== null) return;
    if (mode === "unsend" && !window.confirm("Unsend this message for everyone?")) return;
    setRemovingMessageId(message.message_id);
    setError("");
    try {
      await removeChatMessage(message.message_id, mode);
      setMessages(current => mode === "delete_for_me"
        ? current.filter(item => item.message_id !== message.message_id)
        : current.map(item => item.message_id === message.message_id
          ? { ...item, body: "", image_path: null, image_paths: [], image_urls: [], is_unsent: 1 }
          : item));
    } catch (removeError: unknown) {
      setError(removeError instanceof Error ? removeError.message : "Unable to remove message.");
    } finally {
      setRemovingMessageId(null);
    }
  };

  const activePeer = useMemo(
    () => visibleConversations.find((c) => c.user_id === peerId) ?? null,
    [visibleConversations, peerId]
  );
  const profilePictureUrl = (path?: string | null) => getProfilePictureUrl(path);

  return (
    <DashboardLayout role={role as "admin" | "tenant" | "guest"}>
      <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-4 h-[calc(100dvh-8rem)]">
        {/* Conversation list */}
        <div className="rounded-lg border border-border bg-card overflow-hidden flex flex-col">
          <div className="px-4 py-3 border-b border-border">
            <h2 className="font-display font-semibold">Messages</h2>
            <p className="text-xs text-muted-foreground">Real-time chat</p>
          </div>
          <div className="flex-1 overflow-y-auto">
            {!authChecked && (
              <p className="p-4 text-sm text-muted-foreground">Checking your session...</p>
            )}
            {authChecked && !authUser && (
              <p className="p-4 text-sm text-destructive">{authError || "Please sign in to view messages."}</p>
            )}
            {authUser && conversationsLoading && !conversations && (
              <p className="p-4 text-sm text-muted-foreground">Loading users...</p>
            )}
            {authUser && conversationsError && (
              <p className="p-4 text-sm text-destructive">{conversationsError}</p>
            )}
            {visibleConversations.map((c) => (
              <button
                key={c.user_id}
                onClick={() => setPeerId(c.user_id)}
                className={cn(
                  "w-full text-left px-4 py-3 border-b border-border/50 hover:bg-muted/50 transition-colors",
                  peerId === c.user_id && "bg-muted"
                )}
              >
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center overflow-hidden shrink-0">
                    {profilePictureUrl(c.profile_picture) ? (
                      <img src={profilePictureUrl(c.profile_picture)} alt={`${c.username} profile`} className="h-full w-full object-cover" />
                    ) : <UserRound size={16} className="text-muted-foreground" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium truncate">{c.full_name || c.username}</span>
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground shrink-0">
                        {c.user_type}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      {c.last_message ?? "No messages yet"}
                    </p>
                  </div>
                </div>
              </button>
            ))}
            {authUser && !conversationsLoading && !conversationsError && !visibleConversations.length && (
              <p className="p-4 text-sm text-muted-foreground">No users available.</p>
            )}
          </div>
        </div>

        {/* Thread */}
        <div className="rounded-lg border border-border bg-card flex flex-col overflow-hidden">
          {activePeer ? (
            <>
              <div className="px-4 py-3 border-b border-border">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center overflow-hidden shrink-0">
                    {profilePictureUrl(activePeer.profile_picture) ? (
                      <img src={profilePictureUrl(activePeer.profile_picture)} alt={`${activePeer.username} profile`} className="h-full w-full object-cover" />
                    ) : <UserRound size={18} className="text-muted-foreground" />}
                  </div>
                  <div>
                    <h3 className="font-display font-semibold">{activePeer.full_name || activePeer.username}</h3>
                    <p className="text-xs text-muted-foreground">{activePeer.email}</p>
                  </div>
                </div>
              </div>
              {error && (
                <div className="mx-4 mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {error}
                </div>
              )}
              <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-2">
                {messages.map((m) => {
                  const mine = m.from_user_id === myId;
                  const senderName = mine
                    ? 'You'
                    : m.from_user_id === activePeer?.user_id
                      ? (activePeer.full_name || activePeer.username)
                      : m.from_user_id === 0
                        ? (m.guest_name ?? 'Guest')
                        : (visibleConversations.find(c => c.user_id === m.from_user_id)?.full_name ?? 'User');
                  const unsent = Number(m.is_unsent) === 1;
                  const imageUrls = m.image_urls ?? [];
                  return (
                    <div key={m.message_id} className={cn("flex flex-col gap-1", mine ? "items-end" : "items-start")}>
                      {!mine && (
                        <div className="text-[11px] text-muted-foreground">{senderName}</div>
                      )}
                      {!unsent && imageUrls.length > 0 && (
                        <div className="flex max-w-[75%] flex-col gap-2">
                          {imageUrls.map((url, index) => (
                            <button
                              key={`${m.message_id}-${url}-${index}`}
                              type="button"
                              className="cursor-zoom-in border-0 bg-transparent p-0"
                              aria-label={`View image ${index + 1} of ${imageUrls.length}`}
                              onClick={() => openImageViewer(imageUrls, index)}
                            >
                              <img
                                src={url}
                                alt={`Image attachment ${index + 1}`}
                                className="max-h-80 max-w-full rounded-lg object-contain"
                              />
                            </button>
                          ))}
                        </div>
                      )}
                      {(unsent || m.body) && (
                        <div
                          className={cn(
                            "max-w-[75%] rounded-2xl px-3 py-2 text-sm",
                            mine
                              ? "bg-primary text-primary-foreground rounded-br-sm"
                              : "bg-muted text-foreground rounded-bl-sm"
                          )}
                        >
                          {unsent
                            ? <span className="italic opacity-75">{mine ? "You unsent a message" : "This message was unsent"}</span>
                            : m.body}
                        </div>
                      )}
                      {mine && !unsent && (
                        <div
                          className="px-1 text-[11px] text-muted-foreground"
                          aria-label={
                            Number(m.is_read) === 1
                              ? `Seen by ${activePeer?.full_name || activePeer?.username || "the recipient"}`
                              : `Not seen yet by ${activePeer?.full_name || activePeer?.username || "the recipient"}`
                          }
                        >
                          {Number(m.is_read) === 1
                            ? `Seen by ${activePeer?.full_name || activePeer?.username || "recipient"}`
                            : `Not seen yet by ${activePeer?.full_name || activePeer?.username || "recipient"}`}
                        </div>
                      )}
                      <div className="flex gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-[11px] text-muted-foreground"
                          disabled={removingMessageId !== null}
                          onClick={() => removeMessage(m, "delete_for_me")}
                        >
                          <Trash2 size={12} className="mr-1" />
                          Delete for me
                        </Button>
                        {mine && !unsent && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-[11px] text-muted-foreground"
                            disabled={removingMessageId !== null}
                            onClick={() => removeMessage(m, "unsend")}
                          >
                            Unsend
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
                {!messages.length && (
                  <p className="text-center text-sm text-muted-foreground py-8">
                    Say hello 👋
                  </p>
                )}
              </div>
              <div className="p-3 border-t border-border space-y-2">
                {imageFiles.length > 0 && (
                  <div className="flex gap-2 overflow-x-auto rounded-md border border-border p-2">
                    {imageFiles.map((file, index) => (
                      <div key={`${file.name}-${file.lastModified}-${index}`} className="relative h-24 w-24 shrink-0 overflow-hidden rounded-lg border border-border">
                        <button
                          type="button"
                          className="h-full w-full cursor-zoom-in"
                          aria-label={`View selected image ${index + 1} of ${imageFiles.length}`}
                          onClick={() => openImageViewer(imagePreviewUrls, index)}
                        >
                          <img src={imagePreviewUrls[index]} alt={`Selected image preview ${index + 1}`} className="h-full w-full object-cover" />
                        </button>
                        <Button
                          type="button"
                          variant="secondary"
                          size="icon"
                          className="absolute right-1 top-1 h-6 w-6 rounded-full"
                          aria-label={`Remove selected image ${index + 1}`}
                          onClick={() => {
                            setImageFiles(current => current.filter((_, fileIndex) => fileIndex !== index));
                            if (imageInputRef.current) imageInputRef.current.value = "";
                          }}
                        >
                          <X size={14} />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <input
                    ref={imageInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    multiple
                    className="hidden"
                    aria-label="Choose images to attach"
                    onChange={event => {
                      const files = Array.from(event.target.files ?? []);
                      if (files.some(file => !["image/jpeg", "image/png", "image/webp"].includes(file.type))) {
                        setError("Only JPG, PNG, and WEBP images are allowed.");
                        event.target.value = "";
                        return;
                      }
                      const combinedFiles = [...imageFiles, ...files];
                      if (combinedFiles.length > 5) {
                        setError("You can attach up to 5 images per message.");
                        event.target.value = "";
                        return;
                      }
                      if (combinedFiles.some(file => file.size > 30 * 1024 * 1024)) {
                        setError("Each image must be smaller than 30 MB.");
                        event.target.value = "";
                        return;
                      }
                      if (combinedFiles.reduce((total, file) => total + file.size, 0) > 150 * 1024 * 1024) {
                        setError("Selected images must total less than 150 MB.");
                        event.target.value = "";
                        return;
                      }
                      setError("");
                      setImageFiles(combinedFiles);
                      event.target.value = "";
                    }}
                  />
                  <Button type="button" variant="outline" size="icon" aria-label="Attach images" onClick={() => imageInputRef.current?.click()}>
                    <ImagePlus size={16} />
                  </Button>
                  <Popover open={emojiPickerOpen} onOpenChange={setEmojiPickerOpen}>
                    <PopoverTrigger asChild>
                      <Button type="button" variant="outline" size="icon" aria-label="Choose emoji" aria-expanded={emojiPickerOpen}>
                        <Smile size={16} />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent
                      side="top"
                      align="end"
                      sideOffset={8}
                      collisionPadding={12}
                      className="w-[min(22rem,calc(100vw-1.5rem))] overflow-hidden p-2"
                    >
                      <div className="mb-2 flex items-center justify-between px-1">
                        <span className="text-sm font-medium">Choose an emoji</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          aria-label="Close emoji selector"
                          onClick={() => setEmojiPickerOpen(false)}
                        >
                          <X size={16} />
                        </Button>
                      </div>
                      <Suspense fallback={<div className="p-4 text-sm text-muted-foreground">Loading emojis...</div>}>
                        <EmojiPicker
                          width="100%"
                          height={360}
                          lazyLoadEmojis
                          previewConfig={{ showPreview: false }}
                          onEmojiClick={emojiData => setDraft(current => `${current}${emojiData.emoji}`)}
                        />
                      </Suspense>
                    </PopoverContent>
                  </Popover>
                  <Input
                    value={draft}
                    maxLength={4000}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        send();
                      }
                    }}
                    placeholder="Type a message..."
                  />
                  <Button onClick={send} disabled={(!draft.trim() && !imageFiles.length) || sending} aria-label="Send message">
                    <Send size={16} />
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
              Select a conversation to start chatting.
            </div>
          )}
        </div>
      </div>
      <Dialog open={imageViewer !== null} onOpenChange={open => { if (!open) setImageViewer(null); }}>
        <DialogContent className="max-h-[95vh] w-[calc(100vw-1.5rem)] max-w-6xl gap-3 overflow-hidden p-3 sm:p-5">
          <DialogTitle className="sr-only">Image viewer</DialogTitle>
          <DialogDescription className="sr-only">
            {imageViewer ? `Image ${imageViewer.index + 1} of ${imageViewer.urls.length}` : "View image"}
          </DialogDescription>
          {imageViewer && (
            <div className="flex min-h-0 items-center justify-center gap-2">
              {imageViewer.urls.length > 1 && (
                <Button type="button" variant="outline" size="icon" aria-label="Previous image" onClick={() => moveImageViewer(-1)}>
                  <ChevronLeft />
                </Button>
              )}
              <img
                src={imageViewer.urls[imageViewer.index]}
                alt={`Image ${imageViewer.index + 1} of ${imageViewer.urls.length}`}
                className="max-h-[82vh] min-w-0 max-w-full object-contain"
              />
              {imageViewer.urls.length > 1 && (
                <Button type="button" variant="outline" size="icon" aria-label="Next image" onClick={() => moveImageViewer(1)}>
                  <ChevronRight />
                </Button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
