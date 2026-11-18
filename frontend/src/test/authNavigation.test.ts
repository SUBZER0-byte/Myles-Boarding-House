import { describe, expect, it } from "vitest";
import { getPostLoginPath } from "@/lib/authNavigation";

describe("post-login navigation", () => {
  it("returns users to the requested internal page", () => {
    expect(getPostLoginPath("Tenant", "/#promotional-video")).toBe("/#promotional-video");
  });

  it("uses the role dashboard for missing or external destinations", () => {
    expect(getPostLoginPath("Tenant", null)).toBe("/tenant");
    expect(getPostLoginPath("Guest", "https://example.com")).toBe("/guest");
    expect(getPostLoginPath("Admin", "//example.com")).toBe("/admin");
  });
});
