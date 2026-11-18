import { describe, expect, it } from "vitest";
import { getYoutubeEmbedUrl, getYoutubeVideoId } from "@/lib/promotionalVideoUrls";

describe("promotional video URL parsing", () => {
  it.each([
    ["https://www.youtube.com/watch?v=abcdefghijk", "abcdefghijk"],
    ["https://youtu.be/abcdefghijk?feature=shared", "abcdefghijk"],
    ["https://www.youtube.com/shorts/abcdefghijk", "abcdefghijk"],
    ["https://youtube.com/embed/abcdefghijk", "abcdefghijk"],
  ])("extracts a video ID from %s", (url, expectedId) => {
    expect(getYoutubeVideoId(url)).toBe(expectedId);
  });

  it("creates a safe YouTube embed URL and rejects other hosts or malformed links", () => {
    expect(getYoutubeEmbedUrl("https://youtu.be/abcdefghijk")).toBe(
      "https://www.youtube.com/embed/abcdefghijk",
    );
    expect(getYoutubeVideoId("https://youtube.com.evil.example/watch?v=abcdefghijk")).toBeNull();
    expect(getYoutubeVideoId("not a url")).toBeNull();
  });
});
