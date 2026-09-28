import { flattenSigningSecrets } from "../config.ts";
import type { BillingSigningSecretSet } from "../types.ts";

export type BillingConnectionSigningSecretCache = Map<string, string[]>;

export function rememberConnectionSigningSecret(
  cache: BillingConnectionSigningSecretCache,
  connectionId: string,
  secret: string
): void {
  const trimmed = secret.trim();
  if (trimmed.length === 0) {
    return;
  }
  const existing = cache.get(connectionId) ?? [];
  if (!existing.includes(trimmed)) {
    existing.push(trimmed);
    cache.set(connectionId, existing);
  }
}

export function rememberConnectionSigningSecretSet(
  cache: BillingConnectionSigningSecretCache,
  connectionId: string,
  secrets: BillingSigningSecretSet
): void {
  for (const secret of flattenSigningSecrets(secrets)) {
    rememberConnectionSigningSecret(cache, connectionId, secret);
  }
}

export function signingSecretsForConnection(
  cache: BillingConnectionSigningSecretCache,
  connectionId: string | undefined
): readonly string[] {
  if (connectionId == null || connectionId.length === 0) {
    return [];
  }
  return cache.get(connectionId) ?? [];
}
