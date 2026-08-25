import type {
  AthenaStoredPasskey,
  AthenaStoredPasskeyCreate,
} from "./types.ts";

/**
 * Sole owner of stored passkey credentials.
 * SQL/Memory adapters: `src/auth/local/passkey/repository.ts` (ADR 0034).
 */
export interface PasskeyRepository {
  create(record: AthenaStoredPasskeyCreate): Promise<AthenaStoredPasskey>;
  delete(input: { id: string; userId: string }): Promise<void>;
  findByCredentialId(
    credentialId: Uint8Array
  ): Promise<AthenaStoredPasskey | null>;
  listByUser(userId: string): Promise<AthenaStoredPasskey[]>;
  updateCounter(input: {
    credentialId: Uint8Array;
    expected: bigint;
    next: bigint;
  }): Promise<AthenaStoredPasskey>;
  updateName(input: {
    id: string;
    userId: string;
    name: string;
  }): Promise<AthenaStoredPasskey>;
}
