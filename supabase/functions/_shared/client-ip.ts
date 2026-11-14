function isValidIpAddress(value: string): boolean {
  const ipv4Segments = value.split(".");
  if (ipv4Segments.length === 4) {
    return ipv4Segments.every((segment) => /^\d{1,3}$/.test(segment) && Number(segment) <= 255);
  }
  if (!value.includes(":") || value.includes("%")) return false;

  try {
    new URL(`http://[${value}]/`);
    return true;
  } catch {
    return false;
  }
}

export function getClientIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0];
  const candidates = [
    request.headers.get("cf-connecting-ip"),
    request.headers.get("x-real-ip"),
    forwarded,
  ];

  return candidates
    .map((candidate) => candidate?.trim())
    .find((candidate): candidate is string =>
      Boolean(candidate && candidate.length <= 64 && isValidIpAddress(candidate))
    ) ?? null;
}
