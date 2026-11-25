import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, getSession, upload, createSignedUrl, remove } = vi.hoisted(() => ({
  rpc: vi.fn(),
  getSession: vi.fn(),
  upload: vi.fn(),
  createSignedUrl: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc,
    auth: { getSession },
    storage: {
      from: vi.fn(() => ({ upload, createSignedUrl, remove })),
    },
  },
}));

import {
  canChatWithUserType,
  listChatConversations,
  listChatMessages,
  removeChatMessage,
  sendChatMessage,
  MAX_CHAT_IMAGE_SIZE_BYTES,
} from "@/lib/chatWorkflows";

const authId = "fce10000-0000-4000-8000-000000000001";

describe("Supabase chat workflows", () => {
  beforeEach(() => {
    rpc.mockReset();
    getSession.mockReset();
    upload.mockReset();
    createSignedUrl.mockReset();
    remove.mockReset();
    getSession.mockResolvedValue({ data: { session: { user: { id: authId } } }, error: null });
    upload.mockResolvedValue({ error: null });
    createSignedUrl.mockResolvedValue({ data: { signedUrl: "https://storage.example/chat-image" }, error: null });
    remove.mockResolvedValue({ error: null });
    rpc.mockResolvedValue({ data: { type: "success", data: [] }, error: null });
  });

  it("limits tenant chat peers to tenant and admin accounts", () => {
    expect(canChatWithUserType("Tenant", "Tenant")).toBe(true);
    expect(canChatWithUserType("Tenant", "Admin")).toBe(true);
    expect(canChatWithUserType("Tenant", "Guest")).toBe(false);
    expect(canChatWithUserType("Guest", "Admin")).toBe(true);
    expect(canChatWithUserType("Guest", "Tenant")).toBe(false);
    expect(canChatWithUserType("Admin", "Guest")).toBe(true);
  });

  it("loads conversations through the identity-scoped chat RPC", async () => {
    rpc.mockResolvedValue({
      data: { type: "success", data: [{ user_id: 9, user_type: "Admin" }] },
      error: null,
    });

    await expect(listChatConversations()).resolves.toMatchObject([{ user_id: 9, user_type: "Admin" }]);
    expect(rpc).toHaveBeenCalledWith("manage_my_chat", {
      p_action: "conversations",
      p_data: {},
    });
  });

  it("signs private attachment URLs when loading messages", async () => {
    const path = `${authId}/chat/fce10000-0000-4000-8000-000000000020.png`;
    rpc.mockResolvedValue({
      data: {
        type: "success",
        data: [{
          message_id: 5,
          body: "",
          image_path: null,
          image_paths: [path],
        }],
      },
      error: null,
    });

    await expect(listChatMessages(9)).resolves.toMatchObject([
      { image_paths: [path], image_urls: ["https://storage.example/chat-image"] },
    ]);
    expect(createSignedUrl).toHaveBeenCalledWith(path, 300);
    expect(rpc).toHaveBeenCalledWith("manage_my_chat", {
      p_action: "messages",
      p_data: { peer_id: 9 },
    });
  });

  it("does not resolve legacy PHP attachment paths", async () => {
    rpc.mockResolvedValue({
      data: {
        type: "success",
        data: [{
          message_id: 6,
          body: "",
          image_path: "uploads/chat/old-image.png",
          image_paths: ["uploads/chat/old-image.png"],
        }],
      },
      error: null,
    });

    await expect(listChatMessages(9)).resolves.toMatchObject([{ image_urls: [] }]);
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it("uploads supported images under the signed-in user's storage prefix", async () => {
    const file = new File(["image"], "photo.png", { type: "image/png" });
    rpc.mockResolvedValue({
      data: {
        type: "success",
        data: { message_id: 12, from_user_id: 3, to_user_id: 9, body: "", image_path: null },
      },
      error: null,
    });

    await expect(sendChatMessage(9, "", [file])).resolves.toMatchObject({
      message_id: 12,
      image_urls: [],
    });
    expect(upload).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`^${authId}/chat/[0-9a-f-]{36}\\.png$`)),
      file,
      { contentType: "image/png", upsert: false },
    );
    expect(rpc).toHaveBeenCalledWith("manage_my_chat", {
      p_action: "send",
      p_data: {
        peer_id: 9,
        body: "",
        image_paths: [expect.stringMatching(new RegExp(`^${authId}/chat/[0-9a-f-]{36}\\.png$`))],
      },
    });
  });

  it("allows 100MB per chat image while preserving the 150MB combined limit", async () => {
    const makeImage = (size: number) => {
      const file = new File(["image"], "photo.png", { type: "image/png" });
      Object.defineProperty(file, "size", { value: size });
      return file;
    };
    rpc.mockResolvedValue({
      data: {
        type: "success",
        data: { message_id: 13, from_user_id: 3, to_user_id: 9, body: "", image_path: null },
      },
      error: null,
    });

    await sendChatMessage(9, "", [makeImage(MAX_CHAT_IMAGE_SIZE_BYTES)]);
    await expect(sendChatMessage(9, "", [makeImage(MAX_CHAT_IMAGE_SIZE_BYTES + 1)]))
      .rejects.toThrow("100 MB or smaller");
    await expect(sendChatMessage(9, "", [makeImage(100 * 1024 * 1024), makeImage(51 * 1024 * 1024)]))
      .rejects.toThrow("Selected images must total less than 150 MB.");

    expect(upload).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("rejects unsupported images before upload and removes attachments on unsend", async () => {
    const unsupported = new File(["file"], "document.txt", { type: "text/plain" });
    await expect(sendChatMessage(9, "", [unsupported])).rejects.toThrow("Only JPG, PNG, and WEBP");
    expect(upload).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();

    const path = `${authId}/chat/fce10000-0000-4000-8000-000000000020.png`;
    rpc.mockResolvedValue({
      data: {
        type: "success",
        data: { removed_image_paths: [path] },
      },
      error: null,
    });
    await removeChatMessage(12, "unsend");
    expect(remove).toHaveBeenCalledWith([path]);
  });
});
