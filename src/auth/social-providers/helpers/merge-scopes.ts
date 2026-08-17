/**
 * Merge default, configured, and request-time OAuth scopes without duplicates.
 *
 * Order of application: defaults → `optionScopes` → `requestScopes`.
 * When `disableDefaultScope` is true, the default list is skipped.
 *
 * @param defaults - Provider default scopes (e.g. `openid profile email`)
 * @param optionScopes - Scopes from provider options
 * @param requestScopes - Scopes from the authorization request call
 * @param disableDefaultScope - When true, omit `defaults`
 * @returns Deduplicated scope list preserving first-seen order
 */
export function mergeScopes(
  defaults: string[],
  optionScopes: string[] | undefined,
  requestScopes: string[] | undefined,
  disableDefaultScope?: boolean
): string[] {
  const scopes = disableDefaultScope ? [] : [...defaults];
  if (optionScopes) {
    scopes.push(...optionScopes);
  }
  if (requestScopes) {
    scopes.push(...requestScopes);
  }
  return [...new Set(scopes)];
}
