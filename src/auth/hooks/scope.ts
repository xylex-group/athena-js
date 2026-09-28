import type { AthenaAuthAdminStore } from "../local/admin-contract.ts";
import type { OAuthAuthorizationServerStores } from "../local/authorization-server/store.ts";
import type { AthenaAuthStores } from "../local/store-contract.ts";
import type { TokenKeyStore } from "../local/token-key-store.ts";
import type { AthenaAuthAuditEntry } from "../observability/types.ts";

/**
 * Transaction-scoped stores. The executor never constructs Postgres or Memory
 * implementations; the runtime factory yields this scope.
 */
export interface AthenaAuthMutationScope {
  admin?: AthenaAuthAdminStore;
  /**
   * Transaction-bound OAuth stores. The OAuth service must use these stores
   * for mutations so its state shares the Auth mutation transaction.
   */
  oauth?: OAuthAuthorizationServerStores;
  tokenKeys?: TokenKeyStore;
  /**
   * Bound by the transaction factory when audit persistence shares this tx.
   * Not a database handle — Postgres/Memory stay inside the factory.
   */
  persistAudit?: (entry: AthenaAuthAuditEntry) => Promise<void>;
  stores: AthenaAuthStores;
}

export type AuthMutationTransaction = <T>(
  fn: (scope: AthenaAuthMutationScope) => Promise<T>
) => Promise<T>;
