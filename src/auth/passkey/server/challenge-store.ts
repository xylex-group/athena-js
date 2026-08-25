import type {
  AthenaPasskeyChallenge,
  AthenaPasskeyChallengeConsume,
  AthenaPasskeyChallengeCreate,
} from "./types.ts";

/**
 * Sole write/consume authority for passkey challenges.
 * SQL adapters live in later slices under `src/auth/local/passkey/`.
 */
export interface PasskeyChallengeStore {
  /** Binds challengeHash + purpose + rpId + userId (null = discoverable auth). */
  consume(
    input: AthenaPasskeyChallengeConsume
  ): Promise<AthenaPasskeyChallenge>;
  create(input: AthenaPasskeyChallengeCreate): Promise<AthenaPasskeyChallenge>;
  expire(now?: Date): Promise<number>;
}
