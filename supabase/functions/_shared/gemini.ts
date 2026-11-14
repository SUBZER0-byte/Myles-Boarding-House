export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export function buildGeminiRequestBody(
  systemInstruction: string,
  history: ChatTurn[],
  message: string,
) {
  return {
    systemInstruction: { parts: [{ text: systemInstruction }] },
    contents: [
      ...history.map(turn => ({
        role: turn.role === "assistant" ? "model" : "user",
        parts: [{ text: turn.content }],
      })),
      { role: "user", parts: [{ text: message }] },
    ],
    generationConfig: { maxOutputTokens: 700 },
  };
}

export function extractGeminiReply(response: unknown): string {
  if (!response || typeof response !== "object" || Array.isArray(response)) return "";
  const candidates = (response as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates) || !candidates[0] || typeof candidates[0] !== "object") return "";

  const content = (candidates[0] as { content?: unknown }).content;
  if (!content || typeof content !== "object" || Array.isArray(content)) return "";
  const parts = (content as { parts?: unknown }).parts;
  if (!Array.isArray(parts)) return "";

  return parts
    .map(part => part && typeof part === "object" && "text" in part && typeof part.text === "string"
      ? part.text
      : "")
    .join("")
    .trim();
}
