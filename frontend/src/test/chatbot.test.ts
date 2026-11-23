import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, invoke } = vi.hoisted(() => ({
  rpc: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc,
    functions: { invoke },
  },
}));

import { askChatbot, getChatbotStatus, getChatbotSuggestions } from "@/lib/chatbot";

describe("Supabase chatbot client", () => {
  beforeEach(() => {
    rpc.mockReset();
    invoke.mockReset();
  });

  it("loads the public suggested-question list from Supabase", async () => {
    rpc.mockResolvedValue({ data: [{ question: "How do I book?" }], error: null });
    await expect(getChatbotSuggestions()).resolves.toEqual(["How do I book?"]);
    expect(rpc).toHaveBeenCalledWith("get_public_chatbot_suggestions");
  });

  it("checks provider status through the server-side function", async () => {
    invoke.mockResolvedValue({
      data: { type: "success", status: "offline", message: "AI cloud API key is not configured." },
      error: null,
    });
    await expect(getChatbotStatus()).resolves.toMatchObject({ status: "offline" });
    expect(invoke).toHaveBeenCalledWith("chatbot", { body: { action: "status" } });
  });

  it("sends chat history and abort signal only to the Edge Function", async () => {
    const signal = new AbortController().signal;
    invoke.mockResolvedValue({ data: { type: "success", reply: "Welcome." }, error: null });
    await expect(askChatbot({
      message: "How do I book?",
      history: [{ role: "user", content: "Hello" }],
      language: "english",
    }, signal)).resolves.toMatchObject({ reply: "Welcome." });
    expect(invoke).toHaveBeenCalledWith("chatbot", {
      body: {
        action: "chat",
        message: "How do I book?",
        history: [{ role: "user", content: "Hello" }],
        language: "english",
      },
      signal,
    });
  });

  it("sends Guest Browse Rooms dates when the chatbot is opened in that panel", async () => {
    invoke.mockResolvedValue({ data: { type: "success", reply: "Room 2 has space." }, error: null });
    await askChatbot({
      message: "Is there space for my dates?",
      history: [],
      language: "english",
      availabilityRange: { checkInDate: "2026-12-01", checkOutDate: "2027-01-01" },
    });

    expect(invoke).toHaveBeenCalledWith("chatbot", {
      body: {
        action: "chat",
        message: "Is there space for my dates?",
        history: [],
        language: "english",
        availability_range: {
          check_in_date: "2026-12-01",
          check_out_date: "2027-01-01",
        },
      },
      signal: undefined,
    });
  });

  it("surfaces non-JSON function errors", async () => {
    invoke.mockResolvedValue({
      data: null,
      error: { message: "Function unavailable", context: new Response("unavailable", { status: 503 }) },
    });
    await expect(getChatbotStatus()).rejects.toThrow("Function unavailable");
  });
});
