export function getPostLoginPath(userType: string, requestedPath: unknown): string {
  if (
    typeof requestedPath === "string"
    && requestedPath.startsWith("/")
    && !requestedPath.startsWith("//")
  ) {
    return requestedPath;
  }

  const normalized = (userType || "guest").toLowerCase();
  if (normalized === "admin") return "/admin";
  if (normalized === "tenant") return "/tenant";
  return "/guest";
}
