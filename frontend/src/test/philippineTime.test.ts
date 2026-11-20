import { describe, expect, it } from "vitest";
import {
  formatPhilippineClockTime,
  formatPhilippineDate,
  formatPhilippineDateTime,
  toPhilippineISOString,
} from "@/lib/philippineTime";

describe("Philippine time formatting", () => {
  it("formats timestamps with an explicit timezone independently of the browser timezone", () => {
    expect(formatPhilippineDateTime("2026-11-20T02:00:00.000Z")).toBe(
      "11/20/2026, 10:00:00 AM",
    );
  });

  it("treats timezone-less database timestamps as Philippine wall time", () => {
    expect(formatPhilippineDateTime("2026-11-20 10:00:00")).toBe(
      "11/20/2026, 10:00:00 AM",
    );
  });

  it("keeps date-only values on their stated Philippine calendar day", () => {
    expect(formatPhilippineDate("2026-11-20")).toBe("11/20/2026");
  });

  it("formats clock time in Philippine time", () => {
    expect(formatPhilippineClockTime("2026-11-20T02:00:00.000Z")).toBe("10:00 AM");
  });

  it("serializes timestamps with the Philippine UTC+08:00 offset", () => {
    expect(toPhilippineISOString(new Date("2026-11-20T02:00:00.000Z"))).toBe(
      "2026-11-20T10:00:00.000+08:00",
    );
  });

  it("returns a placeholder for absent or invalid timestamps", () => {
    expect(formatPhilippineDateTime(null)).toBe("—");
    expect(formatPhilippineDateTime("not-a-timestamp")).toBe("—");
  });
});
