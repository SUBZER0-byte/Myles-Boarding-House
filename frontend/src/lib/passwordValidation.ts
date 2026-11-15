export function getPasswordValidationError(newPassword: string, confirmPassword: string): string | null {
  if (newPassword.length < 6 || newPassword.length > 200) {
    return "Password must be 6–200 characters long.";
  }
  if (newPassword !== confirmPassword) {
    return "Passwords do not match.";
  }
  return null;
}
