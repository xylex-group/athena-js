/**
 * Return the provider's primary Client ID.
 *
 * Accepts a single string or an array form used for multi-audience ID token
 * verification (index `0` is the primary client used for authorize/token
 * exchange; later entries are additional accepted audiences only).
 *
 * @param clientId - `string` or `string[]` from provider options
 * @returns Primary non-empty client id, or `undefined` if missing
 */
export function getPrimaryClientId(clientId: unknown): string | undefined {
  const value = Array.isArray(clientId) ? clientId[0] : clientId;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
