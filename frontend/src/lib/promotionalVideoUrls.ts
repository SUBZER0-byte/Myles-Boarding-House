export function getYoutubeVideoId(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;

    const hostname = url.hostname.toLowerCase();
    if (hostname === "youtu.be") {
      return url.pathname.split("/").filter(Boolean)[0]?.match(/^[\w-]{11}$/)?.[0] ?? null;
    }
    if (hostname !== "youtube.com" && hostname !== "www.youtube.com" && hostname !== "m.youtube.com") {
      return null;
    }

    if (url.pathname === "/watch") {
      return url.searchParams.get("v")?.match(/^[\w-]{11}$/)?.[0] ?? null;
    }

    const match = url.pathname.match(/^\/(?:embed|shorts|live)\/([\w-]{11})\/?$/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

export function getYoutubeEmbedUrl(value: string): string | null {
  const videoId = getYoutubeVideoId(value);
  return videoId ? `https://www.youtube.com/embed/${videoId}` : null;
}
