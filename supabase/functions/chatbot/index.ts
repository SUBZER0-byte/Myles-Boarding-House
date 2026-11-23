import { getClientIp } from "../_shared/client-ip.ts";
import { buildChatbotSystemPrompt } from "../_shared/chatbot_prompt.ts";
import { buildGeminiRequestBody, extractGeminiReply, type GeminiTurn } from "../_shared/gemini.ts";
import { createSupabaseAdminClient } from "../_shared/supabase.ts";

type Language = "auto" | "english" | "tagalog";

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };
const MAX_MESSAGE_LENGTH = 2000;
const MAX_HISTORY_LENGTH = 10;

function allowedOrigins(): Set<string> {
  return new Set(
    (Deno.env.get("APP_ALLOWED_ORIGINS") ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
}

function corsHeaders(origin: string): HeadersInit {
  return {
    ...JSON_HEADERS,
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function jsonResponse(
  body: Record<string, unknown>,
  status: number,
  headers: HeadersInit = JSON_HEADERS,
): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} is not configured for the chatbot function.`);
  return value;
}

function validHistory(value: unknown): GeminiTurn[] | null {
  if (!Array.isArray(value) || value.length > MAX_HISTORY_LENGTH) return null;
  const history: GeminiTurn[] = [];
  for (const turn of value) {
    if (!turn || typeof turn !== "object") return null;
    const role = "role" in turn ? turn.role : undefined;
    const content = "content" in turn ? turn.content : undefined;
    if (
      (role !== "user" && role !== "assistant") ||
      typeof content !== "string" ||
      content.length > MAX_MESSAGE_LENGTH
    ) return null;
    history.push({ role, content });
  }
  return history;
}

async function hash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function enforceRateLimit(request: Request, origin: string): Promise<boolean> {
  const ip = getClientIp(request) ?? `origin:${origin}`;
  const supabase = createSupabaseAdminClient();
  const key = await hash(ip);
  const [minuteLimit, hourLimit] = await Promise.all([
    supabase.rpc("consume_chatbot_rate_limit", {
      p_limit_key: await hash(`${key}:minute`),
      p_max_requests: 8,
      p_window_seconds: 60,
    }),
    supabase.rpc("consume_chatbot_rate_limit", {
      p_limit_key: await hash(`${key}:hour`),
      p_max_requests: 50,
      p_window_seconds: 3600,
    }),
  ]);
  if (minuteLimit.error) throw new Error("Could not check the chatbot request limit.");
  if (hourLimit.error) throw new Error("Could not check the chatbot request limit.");
  return minuteLimit.data === true && hourLimit.data === true;
}

async function loadPublicContext(): Promise<Record<string, unknown>> {
  const supabase = createSupabaseAdminClient();
  const [rooms, house, announcements, faqs] = await Promise.all([
    supabase.rpc("get_public_rooms"),
    supabase.rpc("get_public_house_info"),
    supabase.rpc("get_public_announcements"),
    supabase.from("chatbot_faqs")
      .select("category,question,answer")
      .eq("is_active", 1)
      .order("sort_order")
      .limit(50),
  ]);
  const failed = [rooms, house, announcements, faqs].find((result) => result.error);
  if (failed?.error) throw new Error("Could not load chatbot public business context.");

  return {
    rooms: rooms.data ?? [],
    house: house.data ?? [],
    announcements: announcements.data ?? [],
    faqs: faqs.data ?? [],
  };
}

async function askGemini(systemPrompt: string, history: GeminiTurn[], message: string) {
  const apiKey = requiredEnv("GEMINI_API_KEY");
  const model = Deno.env.get("GEMINI_MODEL")?.trim() || "gemini-2.5-flash";
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(buildGeminiRequestBody(systemPrompt, history, message)),
      signal: AbortSignal.timeout(25000),
    },
  );

  if (!response.ok) {
    console.error(`Gemini request failed with HTTP ${response.status}.`);
    return {
      type: response.status === 429 ? "busy" : "error",
      error_type: response.status === 429 ? "rate_limit" : "provider_error",
      message: response.status === 429
        ? "AI is busy. Please wait a moment."
        : "The AI provider could not process the request.",
      retryable: response.status === 429 || response.status >= 500,
    };
  }

  const reply = extractGeminiReply(await response.json());
  if (!reply) {
    console.error("Gemini returned no text candidate.");
    return {
      type: "error",
      error_type: "empty_reply",
      message: "The AI provider returned an empty reply. Please try again.",
      retryable: true,
    };
  }
  return { type: "success", reply, status: "online" };
}

Deno.serve(async (request) => {
  const origin = request.headers.get("origin") ?? "";
  const cors = corsHeaders(origin);
  const origins = allowedOrigins();
  if (!origin || !origins.has(origin)) {
    return jsonResponse({ type: "error", message: "This origin is not allowed." }, 403);
  }
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST") {
    return jsonResponse({ type: "error", message: "Method not allowed." }, 405, cors);
  }
  if (!Deno.env.get("GEMINI_API_KEY")?.trim()) {
    return jsonResponse({
      type: "error",
      status: "offline",
      message: "AI cloud API key is not configured.",
    }, 503, cors);
  }

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return jsonResponse({ type: "error", message: "Invalid request body." }, 400, cors);
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return jsonResponse({ type: "error", message: "Invalid request body." }, 400, cors);
  }

  if (body.action === "status") {
    return jsonResponse({ type: "success", status: "online", message: "AI is online." }, 200, cors);
  }
  if (body.action !== "chat") {
    return jsonResponse({ type: "error", message: "Unsupported chatbot action." }, 400, cors);
  }
  const message = typeof body.message === "string" ? body.message.trim() : "";
  const history = validHistory(body.history);
  const language: Language = body.language === "english" || body.language === "tagalog"
    ? body.language
    : "auto";
  if (!message || message.length > MAX_MESSAGE_LENGTH || !history) {
    return jsonResponse({ type: "error", message: "The message or conversation history is invalid." }, 400, cors);
  }

  try {
    if (!await enforceRateLimit(request, origin)) {
      return jsonResponse({
        type: "busy",
        status: "busy",
        message: "AI is busy. Please wait a moment.",
        retryable: true,
      }, 429, cors);
    }
    const context = await loadPublicContext();
    const prompt = buildChatbotSystemPrompt(JSON.stringify(context), language);
    const result = await askGemini(prompt, history, message);
    const statusCode = result.type === "success" ? 200 : result.type === "busy" ? 429 : 502;
    return jsonResponse(result, statusCode, cors);
  } catch (error) {
    console.error("Chatbot request failed.", error);
    return jsonResponse({
      type: "error",
      error_type: "service_error",
      message: "The chatbot service is temporarily unavailable.",
      retryable: true,
    }, 503, cors);
  }
});
