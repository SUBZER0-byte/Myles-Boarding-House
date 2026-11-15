import { describe, expect, it } from "vitest";
import { getClientIp } from "../../../supabase/functions/_shared/client-ip.ts";

describe("getClientIp", () => {
  it("prefers the proxy-provided client IP", () => {
    const request = new Request("https://example.test", {
      headers: {
        "cf-connecting-ip": "203.0.113.8",
        "x-forwarded-for": "198.51.100.4, 10.0.0.1",
      },
    });

    expect(getClientIp(request)).toBe("203.0.113.8");
  });

  it("uses the first forwarded IP when no direct client IP header is available", () => {
    const request = new Request("https://example.test", {
      headers: { "x-forwarded-for": "198.51.100.4, 10.0.0.1" },
    });

    expect(getClientIp(request)).toBe("198.51.100.4");
  });

  it("accepts IPv6 addresses", () => {
    const request = new Request("https://example.test", {
      headers: { "x-real-ip": "::1" },
    });

    expect(getClientIp(request)).toBe("::1");
  });

  it("ignores invalid and oversized header values", () => {
    const request = new Request("https://example.test", {
      headers: {
        "cf-connecting-ip": "999.999.999.999",
        "x-real-ip": "malformed",
        "x-forwarded-for": `${"1".repeat(65)}, 198.51.100.4`,
      },
    });

    expect(getClientIp(request)).toBeNull();
  });
});
