/**
 * Strip trailing `/` characters without a ReDoS-prone regex (loop-based).
 *
 * Used for OAuth authority/issuer base URLs so endpoint concatenation never
 * produces double slashes that break issuer comparisons.
 *
 * @param value - Absolute or path-like URL string
 * @returns Same string with all trailing slashes removed
 */
export function trimTrailingSlash(value: string): string {
  let result = value;
  while (result.endsWith("/")) {
    result = result.slice(0, -1);
  }
  return result;
}
