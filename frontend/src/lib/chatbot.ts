import { supabase } from "@/lib/supabase";

export type ChatbotStatus = "online" | "busy" | "offline";

export interface ChatbotResponse {
  type?: "success" | "error" | "busy";
  reply?: string;
  message?: string;
  status?: ChatbotStatus;
  error_type?: string;
  retryable?: boolean;
  cached?: boolean;
  debug?: Record<string, unknown> | null;
}

async function invokeChatbot(
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<ChatbotResponse> {
  const { data, error } = await supabase.functions.invoke<ChatbotResponse>("chatbot", { body, signal });
  if (!error) {
    if (!data || typeof data !== "object") throw new Error("The chatbot service returned an invalid response.");
    return data;
  }
  if ("context" in error && error.context instanceof Response) {
    try {
      const response = await error.context.clone().json() as ChatbotResponse;
      if (response && typeof response === "object") return response;
    } catch {
      // Fall through to the function transport error.
    }
  }
  throw new Error(error.message || "The chatbot service is unavailable.");
}

export async function getChatbotSuggestions(): Promise<string[]> {
  const { data, error } = await supabase.rpc("get_public_chatbot_suggestions");
  if (error) throw new Error(error.message || "Could not load chatbot suggestions.");
  if (!Array.isArray(data)) {
    throw new Error("The chatbot service returned an invalid suggestions list.");
  }
  return data.map(item => {
    if (!item || typeof item !== "object" || !("question" in item) || typeof item.question !== "string") {
      throw new Error("The chatbot service returned an invalid suggestions list.");
    }
    return item.question;
  });
}

export function getChatbotStatus(): Promise<ChatbotResponse> {
  return invokeChatbot({ action: "status" });
}

export function askChatbot(input: {
  message: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  language: "auto" | "english" | "tagalog";
}, signal?: AbortSignal): Promise<ChatbotResponse> {
  return invokeChatbot({ action: "chat", ...input }, signal);
}
