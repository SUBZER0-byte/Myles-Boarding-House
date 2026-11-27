import { describe, expect, it } from "vitest";
import { isValidPhilippineMobileNumber, sanitizePhilippinePhoneNumber } from "@/lib/philippinePhone";

describe("Philippine mobile number validation", () => {
  it("accepts a local 11-digit mobile number and rejects non-local or invalid values", () => {
    expect(isValidPhilippineMobileNumber("09171234567")).toBe(true);
    expect(isValidPhilippineMobileNumber("639171234567")).toBe(false);
    expect(isValidPhilippineMobileNumber("09111111111")).toBe(false);
    expect(isValidPhilippineMobileNumber("12345")).toBe(false);
  });

  it("keeps only the first 11 digits for numeric mobile inputs", () => {
    expect(sanitizePhilippinePhoneNumber("09abc123456789")).toBe("09123456789");
  });
});
