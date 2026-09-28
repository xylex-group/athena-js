/**
 * Shared last-viable-authentication-method authority for passkey delete
 * and social unlink. Count remaining accounts + passkeys after an optional
 * exclusion. Do not keep a second Social-only policy.
 */
import type { AthenaAuthStores } from "./memory-stores.ts";
import { createPasskeyRepository } from "./passkey/repository.ts";

export async function countRemainingAuthenticationMethods(
  stores: AthenaAuthStores,
  userId: string,
  exclude?: { accountId?: string; passkeyId?: string }
): Promise<number> {
  const accounts = (await stores.listAccounts(userId)).filter(
    (account) => account.id !== exclude?.accountId
  );
  const passkeys = (
    await createPasskeyRepository(stores).listByUser(userId)
  ).filter((row) => row.id !== exclude?.passkeyId);
  return accounts.length + passkeys.length;
}
