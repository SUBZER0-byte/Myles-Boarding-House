import { describe, expect, it } from "vitest";
import { calculateMoveOutDate, getStayMonths } from "@/lib/stayDates";

describe("stay date calculations", () => {
  it("uses fixed 30-day periods, including across month and year boundaries", () => {
    expect(calculateMoveOutDate("2026-01-31", 1)).toBe("2026-03-02");
    expect(calculateMoveOutDate("2028-01-31", 1)).toBe("2028-03-01");
    expect(getStayMonths("2026-01-31", "2026-03-02")).toBe("1");
    expect(getStayMonths("2026-01-31", "2026-05-01")).toBe("3");
  });

  it("rejects missing or invalid stay durations", () => {
    expect(calculateMoveOutDate("", 1)).toBe("");
    expect(calculateMoveOutDate("2026-01-01", 0)).toBe("");
    expect(calculateMoveOutDate("2026-01-01", 1.5)).toBe("");
    expect(calculateMoveOutDate("2026-01-01", Number.MAX_SAFE_INTEGER)).toBe("");
  });
});
