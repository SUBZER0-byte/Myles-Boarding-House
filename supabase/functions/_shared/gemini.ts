export type GeminiTurn = {
  role: "user" | "assistant";
  content: string;
};

export function buildGeminiRequestBody(
  systemInstruction: string,
  history: GeminiTurn[],
  message: string,
) {
  return {
    systemInstruction: { parts: [{ text: systemInstruction }] },
    contents: [
      ...history.map((turn) => ({
        role: turn.role === "assistant" ? "model" : "user",
        parts: [{ text: turn.content }],
      })),
      { role: "user", parts: [{ text: message }] },
    ],
    generationConfig: { maxOutputTokens: 700 },
  };
}

export function extractGeminiReply(response: unknown): string {
  if (!response || typeof response !== "object") return "";
  const candidates = (response as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates)) return "";

  return candidates
    .flatMap((candidate) => {
      if (!candidate || typeof candidate !== "object") return [];
      const content = (candidate as { content?: unknown }).content;
      if (!content || typeof content !== "object") return [];
      const parts = (content as { parts?: unknown }).parts;
      if (!Array.isArray(parts)) return [];
      return parts.flatMap((part) =>
        part && typeof part === "object" && "text" in part && typeof part.text === "string"
          ? [part.text]
          : []
      );
    })
    .join("")
    .trim();
}
