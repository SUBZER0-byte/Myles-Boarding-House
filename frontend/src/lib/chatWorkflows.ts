import { supabase } from "@/lib/supabase";

const CHAT_IMAGE_BUCKET = "mbh-chat-images";
const CHAT_IMAGE_URL_TTL_SECONDS = 300;
const MAX_CHAT_IMAGE_SIZE = 30 * 1024 * 1024;
const MAX_CHAT_IMAGES = 5;
const MAX_CHAT_IMAGE_TOTAL_SIZE = 150 * 1024 * 1024;

export interface ChatConversation {
  user_id: number;
  full_name: string;
  username: string;
  email: string;
  user_type: string;
  profile_picture?: string | null;
  last_message: string | null;
  last_at: string | null;
}

export interface ChatMessage {
  message_id: number;
  from_user_id: number;
  to_user_id: number;
  body: string;
  created_at: string;
  is_read: number;
  image_path: string | null;
  image_paths: string[];
  image_urls: string[];
  is_unsent: number;
  guest_name?: string | null;
  guest_email?: string | null;
}

interface ChatResponse {
  type: "success" | "error";
  message?: string;
  data?: unknown;
}

const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();

async function invokeChat(action: string, data: Record<string, unknown> = {}): Promise<unknown> {
  const { data: response, error } = await supabase.rpc("manage_my_chat", {
    p_action: action,
    p_data: data,
  });
  if (error) throw new Error(error.message || "Could not complete the chat request.");
  if (!response || typeof response !== "object") {
    throw new Error("The chat service returned an invalid response.");
  }
  const result = response as ChatResponse;
  if (result.type !== "success") {
    throw new Error(result.message || "Could not complete the chat request.");
  }
  return result.data;
}

async function signedImageUrl(path: string): Promise<string> {
  const now = Date.now();
  const cached = signedUrlCache.get(path);
  if (cached && cached.expiresAt > now + 60_000) return cached.url;

  const { data, error } = await supabase.storage
    .from(CHAT_IMAGE_BUCKET)
    .createSignedUrl(path, CHAT_IMAGE_URL_TTL_SECONDS);
  if (error || !data?.signedUrl) {
    throw new Error(error?.message || "A chat image could not be opened.");
  }
  signedUrlCache.set(path, {
    url: data.signedUrl,
    expiresAt: now + CHAT_IMAGE_URL_TTL_SECONDS * 1000,
  });
  return data.signedUrl;
}

async function imageUrls(paths: string[]): Promise<string[]> {
  const storagePaths = paths.filter(path => /^[0-9a-f-]{36}\/chat\/[0-9a-f-]{36}\.(jpg|png|webp)$/i.test(path));
  return Promise.all(storagePaths.map(signedImageUrl));
}

export async function listChatConversations(): Promise<ChatConversation[]> {
  const data = await invokeChat("conversations");
  if (!Array.isArray(data)) throw new Error("The chat service returned an invalid conversation list.");
  return data as ChatConversation[];
}

export async function listChatMessages(peerId: number): Promise<ChatMessage[]> {
  const data = await invokeChat("messages", { peer_id: peerId });
  if (!Array.isArray(data)) throw new Error("The chat service returned an invalid message list.");
  const messages = data as ChatMessage[];
  return Promise.all(messages.map(async message => {
    const paths = message.image_paths?.length
      ? message.image_paths
      : message.image_path ? [message.image_path] : [];
    return { ...message, image_paths: paths, image_urls: await imageUrls(paths) };
  }));
}

function imageExtension(file: File): string {
  if (file.type === "image/jpeg") return "jpg";
  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  throw new Error("Only JPG, PNG, and WEBP images are allowed.");
}

async function uploadChatImages(files: File[]): Promise<string[]> {
  if (files.length > MAX_CHAT_IMAGES) throw new Error("You can attach up to 5 images per message.");
  if (files.some(file => file.size <= 0 || file.size > MAX_CHAT_IMAGE_SIZE)) {
    throw new Error("Each chat image must be smaller than 30 MB.");
  }
  if (files.reduce((total, file) => total + file.size, 0) > MAX_CHAT_IMAGE_TOTAL_SIZE) {
    throw new Error("Selected images must total less than 150 MB.");
  }
  files.forEach(imageExtension);
  if (!files.length) return [];

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw new Error(sessionError.message || "Could not verify your sign-in session.");
  const authUserId = sessionData.session?.user.id;
  if (!authUserId) throw new Error("Sign in before uploading chat images.");

  const uploaded: string[] = [];
  try {
    for (const file of files) {
      const path = `${authUserId}/chat/${crypto.randomUUID()}.${imageExtension(file)}`;
      const { error } = await supabase.storage.from(CHAT_IMAGE_BUCKET).upload(path, file, {
        contentType: file.type,
        upsert: false,
      });
      if (error) throw new Error(error.message || "A chat image could not be uploaded.");
      uploaded.push(path);
    }
    return uploaded;
  } catch (error) {
    if (uploaded.length) {
      const { error: cleanupError } = await supabase.storage.from(CHAT_IMAGE_BUCKET).remove(uploaded);
      if (cleanupError) console.error("Could not remove chat images after an unsuccessful upload:", cleanupError);
    }
    throw error;
  }
}

export async function sendChatMessage(peerId: number, body: string, files: File[]): Promise<ChatMessage> {
  const imagePaths = await uploadChatImages(files);
  let data: unknown;
  try {
    data = await invokeChat("send", { peer_id: peerId, body, image_paths: imagePaths });
  } catch (error) {
    if (imagePaths.length) {
      const { error: cleanupError } = await supabase.storage.from(CHAT_IMAGE_BUCKET).remove(imagePaths);
      if (cleanupError) console.error("Could not remove unlinked chat images:", cleanupError);
    }
    throw error;
  }
  if (!data || typeof data !== "object") throw new Error("The chat service returned an invalid sent message.");
  return { ...(data as ChatMessage), image_paths: imagePaths, image_urls: [] };
}

export async function removeChatMessage(
  messageId: number,
  mode: "delete_for_me" | "unsend",
): Promise<void> {
  const data = await invokeChat("remove", { message_id: messageId, mode });
  if (mode !== "unsend" || !data || typeof data !== "object") return;
  const paths = (data as { removed_image_paths?: unknown }).removed_image_paths;
  if (!Array.isArray(paths)) return;
  const uploadedPaths = paths.filter((path): path is string =>
    typeof path === "string" && /^[0-9a-f-]{36}\/chat\/[0-9a-f-]{36}\.(jpg|png|webp)$/i.test(path)
  );
  if (!uploadedPaths.length) return;
  const { error } = await supabase.storage.from(CHAT_IMAGE_BUCKET).remove(uploadedPaths);
  if (error) throw new Error(`Message was unsent, but its images could not be removed from Storage: ${error.message}`);
  uploadedPaths.forEach(path => signedUrlCache.delete(path));
}

export async function getChatUnreadCount(): Promise<number> {
  const data = await invokeChat("unread_count");
  if (!data || typeof data !== "object" || !("count" in data) || typeof data.count !== "number") {
    throw new Error("The chat service returned an invalid unread count.");
  }
  return data.count;
}
