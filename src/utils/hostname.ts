const LOCAL_IPV4_PATTERN = /^127(?:\.\d{1,3}){3}$/;

export function isLocalHostname(hostname: string): boolean {
  const normalized = hostname.trim().replace(/\.$/, "").toLowerCase();
  if (!normalized) {
    return false;
  }

  if (normalized === "localhost" || normalized.endsWith(".localhost")) {
    return true;
  }

  if (
    normalized === "127.0.0.1" ||
    LOCAL_IPV4_PATTERN.test(normalized) ||
    normalized === "::1" ||
    normalized === "[::1]" ||
    normalized === "0:0:0:0:0:0:0:1"
  ) {
    return true;
  }

  return false;
}
