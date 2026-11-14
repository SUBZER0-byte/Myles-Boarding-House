const imageExtension = /\.(jpg|jpeg|png|webp)$/i;

export function isSupabaseStorageImagePath(path: string): boolean;
export function isSupabaseStorageImagePath(path: string | null | undefined): path is string;
export function isSupabaseStorageImagePath(path: string | null | undefined): boolean {
  if (
    !path
    || path.length > 1024
    || path.startsWith("/")
    || path.includes("\\")
    || /[?#\u0000-\u001f\u007f]/.test(path)
    || /^[a-z][a-z0-9+.-]*:/i.test(path)
    || !imageExtension.test(path)
  ) {
    return false;
  }

  return path.split("/").every(segment => segment !== "" && segment !== "." && segment !== "..");
}
