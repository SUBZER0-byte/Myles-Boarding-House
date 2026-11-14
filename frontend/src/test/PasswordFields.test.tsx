import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PasswordFields } from "@/components/PasswordFields";
import { getPasswordValidationError } from "@/lib/passwordValidation";

describe("PasswordFields", () => {
  afterEach(() => {
    cleanup();
  });

  it("shares the same password inputs and visibility controls, with an optional current-password field", () => {
    render(
      <PasswordFields
        idPrefix="settings"
        currentPassword="current-password"
        onCurrentPasswordChange={() => {}}
        newPassword="new-password"
        confirmPassword="new-password"
        onNewPasswordChange={() => {}}
        onConfirmPasswordChange={() => {}}
      />,
    );

    const currentPassword = screen.getByLabelText("Current password") as HTMLInputElement;
    expect(currentPassword.type).toBe("password");
    expect(screen.getByLabelText("Confirm new password")).not.toBeNull();
    expect(screen.getByText("Password must be 6–200 characters long.")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show current password" }));
    expect(currentPassword.type).toBe("text");
  });

  it("does not render a current-password field for reset-by-code flows", () => {
    render(
      <PasswordFields
        idPrefix="forgot"
        newPassword=""
        confirmPassword=""
        onNewPasswordChange={() => {}}
        onConfirmPasswordChange={() => {}}
      />,
    );

    expect(screen.queryByLabelText("Current password")).toBeNull();
    expect(screen.getByLabelText("New password")).not.toBeNull();
  });
});

describe("getPasswordValidationError", () => {
  it("enforces the same length and confirmation rules across reset and settings flows", () => {
    expect(getPasswordValidationError("12345", "12345")).toBe("Password must be 6–200 characters long.");
    expect(getPasswordValidationError("a".repeat(201), "a".repeat(201))).toBe("Password must be 6–200 characters long.");
    expect(getPasswordValidationError("password1", "password2")).toBe("Passwords do not match.");
    expect(getPasswordValidationError("123456", "123456")).toBeNull();
    expect(getPasswordValidationError("a".repeat(200), "a".repeat(200))).toBeNull();
  });
});
