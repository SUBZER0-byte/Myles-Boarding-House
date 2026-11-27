import { describe, expect, it } from "vitest";
import { calculateMoveOutDate, getStayMonths } from "@/lib/stayDates";

describe("stay date calculations", () => {
  it("adds calendar months and clamps month-end dates", () => {
    expect(calculateMoveOutDate("2026-12-01", 1)).toBe("2027-01-01");
    expect(calculateMoveOutDate("2028-02-01", 1)).toBe("2028-03-01");
    expect(calculateMoveOutDate("2026-01-31", 1)).toBe("2026-02-28");
    expect(calculateMoveOutDate("2028-01-31", 1)).toBe("2028-02-29");
    expect(calculateMoveOutDate("2026-01-31", 2)).toBe("2026-03-31");
    expect(calculateMoveOutDate("2026-03-31", 1)).toBe("2026-04-30");
    expect(calculateMoveOutDate("2026-12-31", 1)).toBe("2027-01-31");
  });

  it("infers calendar-month durations from month-end checkout dates", () => {
    expect(getStayMonths("2026-01-31", "2026-02-28")).toBe("1");
    expect(getStayMonths("2028-01-31", "2028-02-29")).toBe("1");
    expect(getStayMonths("2026-01-31", "2026-03-31")).toBe("2");
    expect(getStayMonths("2026-05-31", "2026-08-31")).toBe("3");
  });

  it("rejects missing or invalid stay durations", () => {
    expect(calculateMoveOutDate("", 1)).toBe("");
    expect(calculateMoveOutDate("2026-01-01", 0)).toBe("");
    expect(calculateMoveOutDate("2026-01-01", 1.5)).toBe("");
    expect(calculateMoveOutDate("2026-01-01", Number.MAX_SAFE_INTEGER)).toBe("");
  });
});
