import { describe, expect, it } from "vitest";
import { filterProfanity } from "@/lib/profanityFilter";

describe("filterProfanity", () => {
  it("replaces profane words with one asterisk per character", () => {
    expect(filterProfanity("FUCK, damn!")).toBe("****, ****!");
  });

  it("matches whole words without changing clean words or punctuation", () => {
    expect(filterProfanity("classical passage; shit.")).toBe("classical passage; ****.");
  });

  it("filters common Filipino profanity, including multiword phrases", () => {
    expect(filterProfanity("Gago ka, puta; putang ina mo! Yawa."))
      .toBe("**** ka, ****; ****** *** mo! ****.");
  });

  it("filters listed English and Filipino insults and preserves phrase spacing", () => {
    const words = [
      "idiot",
      "moron",
      "stupid",
      "loser",
      "scumbag",
      "jerk",
      "freak",
      "retard",
      "baliw",
      "demonyo",
      "hayop",
      "animal",
      "peste",
      "kingina",
      "tite",
      "pepe",
      "puke",
      "bayag",
    ];
    expect(filterProfanity(words.join(" ")))
      .toBe(words.map(word => "*".repeat(word.length)).join(" "));
    expect(filterProfanity("WALANG HIYA; anak ng puta!"))
      .toBe("****** ****; **** ** ****!");
  });
});
