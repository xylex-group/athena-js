import type { AthenaEmailProvider } from "./types.ts";

/**
 * Type guard for root email adapters. SMTP and other transports implement
 * {@link AthenaEmailProvider} and enter the client only through `createClient({ email })`.
 */
export function isAthenaEmailProvider(
  value: unknown
): value is AthenaEmailProvider {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<AthenaEmailProvider>;
  return (
    typeof candidate.send === "function" &&
    typeof candidate.id === "string" &&
    candidate.id.trim().length > 0
  );
}

/**
 * Extension seam for provider adapters. Returns a public-neutral provider:
 * `id` is trimmed and `send` is the only callable surface.
 *
 * Node-only transports (SMTP) must live in a separate adapter module that is
 * never imported from the browser `createClient()` path.
 */
export function defineAthenaEmailProvider(
  provider: AthenaEmailProvider
): AthenaEmailProvider {
  if (!isAthenaEmailProvider(provider)) {
    throw new TypeError(
      "Athena email provider adapters must expose a non-empty id and send()."
    );
  }
  const id = provider.id.trim();
  return {
    ...(provider.capabilities ? { capabilities: provider.capabilities } : {}),
    id,
    send: (message) => provider.send(message),
  };
}
