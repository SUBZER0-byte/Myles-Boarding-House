import { useEffect, useRef, useState } from "react";
import { MessageCircle, X, Send, Sparkles } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { usePolling } from "@/hooks/usePolling";

type ChatMessage = {
  role: "user" | "assistant";
  message: string;
  created_at?: string;
};

type AiStatus = "online" | "busy" | "offline";

type ChatApiResponse = {
  type?: string;
  reply?: string;
  message?: string;
  status?: AiStatus;
  error_type?: string;
  retryable?: boolean;
  cached?: boolean;
  debug?: Record<string, unknown> | null;
};

const DEFAULT_GREETING =
  "Hello! I'm your Myle's Boarding House assistant. How can I help you today?";
const MAX_MESSAGES = 24;

function getFriendlyMessage(data: ChatApiResponse | undefined, fallback: string) {
  if (data?.message) {
    return String(data.message);
  }

  if (data?.type === "busy") {
    return "AI is busy. Please wait a moment.";
  }

  if (data?.error_type === "timeout") {
    return "AI is taking longer than expected. Please wait a moment.";
  }

  if (data?.error_type === "connection_refused" || data?.error_type === "connection_reset") {
    return "AI server is temporarily unavailable. Please try again shortly.";
  }

  return fallback;
}

export function ChatbotWidget() {
  const { data: adminSuggestions, error: suggestionsError } = usePolling<string[]>(
    "/Chat/ollama.php?action=suggestions",
    { intervalMs: 5000 },
  );
  const suggestions = [...new Set([...(adminSuggestions ?? []), "How do I book a room?", "What rooms are available and how much are they?", "How do I check room rates and booking costs?", "What room details can you show me?", "How do I use GPS directions to the boarding house?", "What are the latest announcements?", "How do I create an account?", "How do I pay my rent?", "How do I request a full rent payment?", "How do I cancel my booking or tenancy?", "How do I request a refund?", "How do I leave a rating?", "How do I report a maintenance issue?", "How do I file a complaint?"])];
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: "assistant", message: DEFAULT_GREETING },
  ]);
  const [input, setInput] = useState("");
  const [preferredLanguage, setPreferredLanguage] = useState<"auto" | "english" | "tagalog">("auto");
  const [showSuggestions, setShowSuggestions] = useState(true);
  const [isTyping, setIsTyping] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [aiStatus, setAiStatus] = useState<AiStatus>("online");
  const [statusMessage, setStatusMessage] = useState("AI is thinking...");
  const [debugInfo, setDebugInfo] = useState<Record<string, unknown> | null>(null);
  const [requestPending, setRequestPending] = useState(false);
  const [showLongWaitMessage, setShowLongWaitMessage] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const activeControllerRef = useRef<AbortController | null>(null);
  const requestCounterRef = useRef(0);
  const messagesRef = useRef<ChatMessage[]>([]);
  const waitTimerRef = useRef<number | null>(null);
  const streamTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [isOpen, messages, isTyping]);

  useEffect(() => {
    let mounted = true;

    const checkStatus = async () => {
      try {
        const { data } = await api.post<ChatApiResponse>("/Chat/ollama.php", { action: "status" });
        if (!mounted) return;
        setAiStatus(data?.status ?? "offline");
        setStatusMessage(data?.message ?? "AI is online.");
      } catch {
        if (!mounted) return;
        setAiStatus("offline");
      }
    };

    checkStatus();
    const intervalId = window.setInterval(checkStatus, 30000);
    return () => {
      mounted = false;
      window.clearInterval(intervalId);
    };
  }, []);

  const clampMessages = (next: ChatMessage[]) => next.slice(-MAX_MESSAGES);

  const formatTimestamp = (createdAt?: string) => {
    if (!createdAt) return "";
    const d = new Date(createdAt);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const appendMessage = (message: ChatMessage) => {
    const next = clampMessages([...messagesRef.current, message]);
    messagesRef.current = next;
    setMessages(next);
  };

  const updateLastAssistantMessage = (message: string) => {
    const next = [...messagesRef.current];
    if (next.length === 0) return;
    const lastIndex = next.length - 1;
    if (next[lastIndex].role !== "assistant") return;
    next[lastIndex] = { ...next[lastIndex], message };
    messagesRef.current = next;
    setMessages(next);
  };

  const streamAssistantReply = (reply: string, requestId: number) => {
    const words = reply.match(/\S+\s*/g) ?? [reply];
    if (words.length === 0) {
      return;
    }

    setIsStreaming(true);
    setIsTyping(false);
    const placeholder = { role: "assistant" as const, message: "", created_at: new Date().toISOString() };
    appendMessage(placeholder);

    let index = 0;
    const renderNextChunk = () => {
      if (requestId !== requestCounterRef.current || activeControllerRef.current?.signal.aborted) {
        return;
      }

      const nextText = words.slice(0, index + 1).join("");
      updateLastAssistantMessage(nextText);
      index += 1;

      if (index < words.length) {
        streamTimerRef.current = window.setTimeout(renderNextChunk, 18);
      } else {
        setIsTyping(false);
        setIsStreaming(false);
        setRequestPending(false);
        setShowLongWaitMessage(false);
        if (streamTimerRef.current) {
          window.clearTimeout(streamTimerRef.current);
          streamTimerRef.current = null;
        }
      }
    };

    renderNextChunk();
  };

  const handleSendRequest = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    if (requestPending || activeControllerRef.current) {
      return;
    }

    const requestId = ++requestCounterRef.current;
    const history = messagesRef.current
      .filter((m) => m.message)
      .slice(-10)
      .map((m) => ({ role: m.role, content: m.message }));

    if (waitTimerRef.current) {
      window.clearTimeout(waitTimerRef.current);
      waitTimerRef.current = null;
    }

    setRequestPending(true);
    setIsStreaming(false);
    setShowLongWaitMessage(false);
    waitTimerRef.current = window.setTimeout(() => {
      setShowLongWaitMessage(true);
    }, 8000);

    appendMessage({ role: "user", message: trimmed, created_at: new Date().toISOString() });
    setInput("");
    setIsTyping(true);
    setAiStatus("busy");
    setStatusMessage("AI is thinking...");

    const controller = new AbortController();
    activeControllerRef.current = controller;

    let attempt = 0;
    const maxAttempts = 2;

    try {
      while (attempt <= maxAttempts) {
        if (controller.signal.aborted) {
          return;
        }

        try {
          const { data } = await api.post<ChatApiResponse>(
            "/Chat/ollama.php",
            {
              message: trimmed,
              history,
              language: preferredLanguage,
              action: "chat",
            },
            { signal: controller.signal },
          );

          const reply = data?.type === "success" && data.reply
            ? String(data.reply)
            : getFriendlyMessage(data, "AI server is temporarily unavailable. Please try again shortly.");

          if (data?.type === "success") {
            setAiStatus(data.status ?? "online");
            setStatusMessage("");
            setDebugInfo(data.debug ?? null);
            streamAssistantReply(reply, requestId);
            return;
          }

          if (data?.retryable && attempt < maxAttempts) {
            attempt += 1;
            setStatusMessage("Retrying...");
            continue;
          }

          streamAssistantReply(reply, requestId);
          setAiStatus("offline");
          setStatusMessage("");
          return;
        } catch (err: unknown) {
          if (controller.signal.aborted) {
            return;
          }

          const responseData = err && typeof err === "object" && "response" in err
            ? (err as { response?: { data?: ChatApiResponse } }).response?.data
            : undefined;
          const statusCode = err && typeof err === "object" && "response" in err
            ? (err as { response?: { status?: number } }).response?.status
            : undefined;
          if ((statusCode === 429 || responseData?.type === "busy") && attempt < maxAttempts) {
            attempt += 1;
            setStatusMessage("AI is busy. Retrying...");
            await new Promise((resolve) => window.setTimeout(resolve, 1000));
            continue;
          }

          const message = err && typeof err === "object" && "message" in err
            ? String((err as { message: unknown }).message)
            : "Network error";

          const friendlyMessage = responseData?.message || (
            statusCode === 429 ? "AI is busy. Please wait a moment." : null
          );
          if (attempt < maxAttempts && message.toLowerCase().includes("timeout")) {
            attempt += 1;
            setStatusMessage("Retrying...");
            continue;
          }

          streamAssistantReply(
            `⚠️ ${message.includes("canceled") ? "The previous request was cancelled." : friendlyMessage || "I'm currently having difficulty processing your request. Please try again in a few moments."}`,
            requestId,
          );
          setAiStatus("offline");
          setStatusMessage("");
          return;
        }
      }
    } finally {
      if (requestId === requestCounterRef.current) {
        setShowLongWaitMessage(false);
        if (waitTimerRef.current) {
          window.clearTimeout(waitTimerRef.current);
          waitTimerRef.current = null;
        }
        activeControllerRef.current = null;
      }
    }

    if (requestId === requestCounterRef.current) {
      streamAssistantReply("⚠️ I'm currently having difficulty processing your request. Please try again in a few moments.", requestId);
      setAiStatus("offline");
      setStatusMessage("");
    }
  };

  useEffect(() => {
    return () => {
      activeControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const sendMessage = () => {
    if (!input.trim() || isTyping || requestPending) return;
    handleSendRequest(input);
  };

  const handleSuggestionClick = (s: string) => {
    handleSendRequest(s);
  };

  const handleManualInput = (value: string) => {
    setInput(value);
    if (value.trim()) {
      setShowSuggestions(false);
    } else if (!value.trim() && !isTyping && !requestPending && messages.length <= 1) {
      setShowSuggestions(true);
    }
  };

  return (
    <>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            className="chatbot-panel-position fixed z-[1000] rounded-3xl overflow-hidden shadow-[0_40px_120px_rgba(15,23,42,0.18)] border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-950 flex min-h-0 flex-col"
          >
            <div className="chatbot-panel-header shrink-0 bg-gradient-to-r from-orange-500 via-orange-600 to-orange-700 px-4 py-4 text-white">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-orange-100 sm:text-sm sm:tracking-[0.32em]">
                    <Sparkles size={16} /> Chat Assistant
                  </div>
                  <h2 className="mt-2 text-lg font-semibold">Myle's Boarding House</h2>
                  <p className="chatbot-panel-description mt-1 text-xs text-orange-100">
                    Ask about rooms, payments, booking, policies, or tenant support.
                  </p>
                </div>
                <button
                  onClick={() => setIsOpen(false)}
                  className="rounded-full border border-white/10 bg-white/10 p-2 text-white transition hover:bg-white/20"
                  aria-label="Close chat"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain bg-slate-50 p-4 dark:bg-slate-900">
              {messages.map((m, i) => (
                <div
                  key={`${m.role}-${i}`}
                  className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`min-w-0 max-w-[85%] rounded-[2rem] px-4 py-3 text-sm leading-6 shadow-sm ${
                      m.role === "user"
                        ? "rounded-br-[0.6rem] bg-gradient-to-r from-orange-500 to-orange-600 text-white shadow-orange-200/60"
                        : "rounded-bl-[0.6rem] bg-white text-slate-900 shadow-orange-100/90 dark:bg-slate-800 dark:text-slate-100"
                    }`}
                  >
                    <div className="whitespace-pre-wrap break-words">{m.message}</div>
                    {m.created_at && (
                      <div className={`mt-2 text-[11px] text-right ${m.role === "user" ? "text-orange-100" : "text-slate-500 dark:text-slate-400"}`}>
                        {formatTimestamp(m.created_at)}
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {isTyping && !isStreaming && (
                <div className="flex justify-start">
                  <div className="rounded-[2rem] bg-white px-4 py-3 text-sm text-slate-700 shadow-slate-200/80 dark:bg-slate-800 dark:text-slate-100">
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1 py-1">
                        {[0, 1, 2].map((dot) => (
                          <span
                            key={dot}
                            className="inline-block h-2 w-2 rounded-full bg-orange-500"
                            style={{ animation: "pulse 1.2s infinite ease-in-out", animationDelay: `${dot * 120}ms` }}
                          />
                        ))}
                      </div>
                    </div>
                    {showLongWaitMessage && (
                      <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                        Still processing your request. Thank you for waiting.
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            <div className="chatbot-panel-footer min-h-0 shrink overflow-y-auto overscroll-contain border-t border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-950">
              <div className="mb-2 flex items-center justify-between text-[11px] uppercase tracking-[0.3em] text-slate-500 dark:text-slate-400">
                <span className="flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 rounded-full ${aiStatus === "online" ? "bg-emerald-500" : aiStatus === "busy" ? "bg-amber-500" : "bg-rose-500"}`} />
                  {aiStatus === "online" ? "AI Online" : aiStatus === "busy" ? "AI Busy" : "AI Offline"}
                </span>
                {import.meta.env.DEV && <span className="text-[10px] normal-case tracking-normal">Dev mode</span>}
              </div>
              {import.meta.env.DEV && debugInfo && (
                <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                  {Object.entries(debugInfo).map(([key, value]) => (
                    <div key={key} className="flex justify-between gap-4">
                      <span>{key}</span>
                      <span className="font-mono">{String(value)}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="mb-3">
                <button
                  type="button"
                  onClick={() => setShowSuggestions((value) => !value)}
                  className="flex w-full items-center justify-between gap-2 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-left text-[11px] font-medium uppercase tracking-[0.25em] text-orange-700 transition hover:bg-orange-100 dark:border-orange-400/25 dark:bg-orange-400/10 dark:text-orange-200 dark:hover:bg-orange-400/15"
                >
                  <span>Suggested questions</span>
                  <span className="text-base leading-none text-orange-600 dark:text-orange-300">
                    {showSuggestions ? "−" : "+"}
                  </span>
                </button>

                {showSuggestions && (
                  <div className="chatbot-panel-suggestions mt-3 max-h-40 space-y-2 overflow-y-auto overscroll-contain pr-2">
                    {suggestionsError && (
                      <p className="text-xs text-rose-600 dark:text-rose-300">Unable to load suggested questions. Please try again later.</p>
                    )}
                    {suggestions.map((prompt) => (
                      <button
                        key={prompt}
                        type="button"
                        onClick={() => handleSuggestionClick(prompt)}
                        className="w-full break-words rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-left text-[13px] text-orange-900 transition hover:border-orange-300 hover:bg-orange-100 dark:border-orange-400/20 dark:bg-orange-400/10 dark:text-orange-100 dark:hover:border-orange-400/40 dark:hover:bg-orange-400/15"
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="chatbot-panel-composer sticky bottom-0 -mx-4 bg-white px-4 pt-2 dark:bg-slate-950">
                <div className="flex items-end gap-2">
                  <div className="flex w-16 min-w-16 flex-col items-start sm:w-[88px] sm:min-w-[88px]">
                    <label className="mb-1 hidden text-[10px] font-medium uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400 sm:block">
                      Language
                    </label>
                    <select
                      value={preferredLanguage}
                      onChange={(e) => setPreferredLanguage(e.target.value as "auto" | "english" | "tagalog")}
                      aria-label="Response language"
                      className="w-full rounded-md border border-orange-200 bg-white px-1 py-1.5 text-xs text-slate-700 focus:border-orange-400 focus:ring-orange-200 focus:ring-2 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 sm:px-2 sm:text-sm"
                    >
                      <option value="auto">Auto</option>
                      <option value="english">English</option>
                      <option value="tagalog">Tagalog</option>
                    </select>
                  </div>
                  <input
                    value={input}
                    onChange={(e) => handleManualInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        if (!isTyping) {
                          sendMessage();
                        }
                      }
                    }}
                    placeholder={isTyping ? "Waiting for response..." : "Type your message..."}
                    disabled={isTyping}
                    className="min-h-[44px] min-w-0 flex-1 rounded-3xl border border-orange-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-orange-400 focus:ring-2 focus:ring-orange-200 disabled:cursor-not-allowed disabled:bg-orange-50"
                  />
                  <Button
                    size="sm"
                    onClick={sendMessage}
                    disabled={isTyping || !input.trim()}
                    className="h-11 w-11 shrink-0 rounded-full bg-orange-500 p-0 text-white hover:bg-orange-600"
                  >
                    <Send size={18} />
                  </Button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <button
        onClick={() => {
          if (!isOpen) setShowSuggestions(true);
          setIsOpen(!isOpen);
        }}
        className="chatbot-toggle-position fixed z-[1000] flex h-12 w-12 items-center justify-center rounded-full bg-orange-600 text-white shadow-[0_20px_60px_rgba(249,115,22,0.28)] transition hover:bg-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-300 xl:h-16 xl:w-16"
        aria-label="Open chatbot"
      >
        {isOpen ? <X size={26} /> : <MessageCircle size={26} />}
      </button>
    </>
  );
}
