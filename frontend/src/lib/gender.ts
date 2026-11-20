export const GENDER_OPTIONS = [
  "Female",
  "Male",
  "Non-binary",
  "Other",
  "Prefer not to say",
] as const;

export type Gender = typeof GENDER_OPTIONS[number];

export function isGender(value: unknown): value is Gender {
  return typeof value === "string" && GENDER_OPTIONS.some(option => option === value);
}

export function parseGender(value: unknown): Gender | null {
  if (value === null) return null;
  if (isGender(value)) return value;
  throw new Error("The profile contains an invalid gender value.");
}

export function formatGender(value: string | null | undefined): string {
  return value || "Not provided";
}
