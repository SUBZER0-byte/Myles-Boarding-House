export function sanitizePhilippinePhoneNumber(value: string): string {
  return value.replace(/\D/g, "").slice(0, 11);
}

export function isValidPhilippineMobileNumber(value: string): boolean {
  const normalized = value.trim();
  return /^09\d{9}$/.test(normalized)
    && normalized !== "09111111111"
    && !/^(\d)\1{10}$/.test(normalized);
}
