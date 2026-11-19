import { describe, expect, it } from "vitest";
import { filterProfanity } from "@/lib/profanityFilter";

describe("filterProfanity", () => {
  it("replaces profane words with one asterisk per character", () => {
    expect(filterProfanity("FUCK, damn!")).toBe("****, ****!");
  });

  it("matches whole words without changing clean words or punctuation", () => {
    expect(filterProfanity("classical passage; shit.")).toBe("classical passage; ****.");
  });
});
