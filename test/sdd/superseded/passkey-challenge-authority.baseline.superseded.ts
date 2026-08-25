/**
 * SUPERSEDED by test/sdd/passkey-challenge-authority.target.test.ts
 *
 * Former characterization of pre-adapter CURRENT (Track B dual-suite):
 * - B-CHAL-PORT: PasskeyChallengeStore port at server/challenge-store.ts (stay-true)
 * - B-CHAL-CONSUME-SHAPE: consume binds hash + purpose + rpId + userId: string | null (stay-true)
 * - B-CHAL-NO-ADAPTER: src/auth/local/passkey/ absent
 * - B-CHAL-NO-ID-VALUE: no identifier+value consume; generic consume is value-only DELETE
 * - B-CHAL-MEMORY-TOCTOU: generic Memory consumeVerification is get-then-delete without a mutex (stay-true for generic path)
 * - B-CHAL-NO-CONSUMED-AT: schema v1 has no consumed_at (stay-true)
 * - B-CHAL-FAIL-CLOSED: passkeys:false; seven missing routes; construct throw (stay-true)
 *
 * Active baseline file deleted after adapter + atomic consume landed:
 * B-CHAL-NO-ADAPTER inverted (local/passkey adapter exists);
 * B-CHAL-NO-ID-VALUE identifier+value-absent cell inverted
 * (consumeVerificationByIdentifier / consumeByIdentifierAndValue).
 * Target suite (T-CHAL-* / CH-01…CH-08) is the CI source of truth.
 *
 * Kept as a record only (not a *.test.ts file so CI does not run it).
 */
export const SUPERSEDED_BY =
	"test/sdd/passkey-challenge-authority.target.test.ts";

export const SUPERSEDED_IDS = [
	"B-CHAL-PORT",
	"B-CHAL-CONSUME-SHAPE",
	"B-CHAL-NO-ADAPTER",
	"B-CHAL-NO-ID-VALUE",
	"B-CHAL-MEMORY-TOCTOU",
	"B-CHAL-NO-CONSUMED-AT",
	"B-CHAL-FAIL-CLOSED",
] as const;
