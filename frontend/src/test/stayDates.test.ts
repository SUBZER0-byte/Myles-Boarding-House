import { describe, expect, it } from "vitest";
import { calculateMoveOutDate, getStayMonths } from "@/lib/stayDates";

describe("stay date calculations", () => {
  it("clamps month-end move-out dates correctly and recovers the duration", () => {
    expect(calculateMoveOutDate("2026-01-31", 1)).toBe("2026-02-28");
    expect(calculateMoveOutDate("2028-01-31", 1)).toBe("2028-02-29");
    expect(getStayMonths("2028-01-31", "2028-02-29")).toBe("1");
  });

  it("rejects missing or invalid stay durations", () => {
    expect(calculateMoveOutDate("", 1)).toBe("");
    expect(calculateMoveOutDate("2026-01-01", 0)).toBe("");
    expect(calculateMoveOutDate("2026-01-01", 1.5)).toBe("");
  });
});
