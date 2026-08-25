/**
 * SUPERSEDED by test/sdd/passkey-runtime-finality.server-contract.target.test.ts
 *
 * Former characterization of pre-amendment CURRENT (hash-on-start-result):
 * - B-SRV-START-HASH: start results declare challengeHash: Uint8Array
 * - B-SRV-START-NO-RAW: start results do not declare challenge: Uint8Array
 * - B-SRV-CONSUME-NO-USER: consume is {challengeHash, purpose, rpId} with no userId
 * - B-SRV-PERSIST-HASH: Challenge/Create persist challengeHash only (stay-true)
 *
 * Active baseline deleted after types-only implement: B-SRV-START-HASH,
 * B-SRV-START-NO-RAW, and B-SRV-CONSUME-NO-USER inverted (raw challenge on
 * start results; consume binds userId: string | null). B-SRV-PERSIST-HASH
 * stayed true. Target suite is the CI source of truth.
 *
 * Kept as a record only (not a *.test.ts file so CI does not run it).
 */
export const SUPERSEDED_BY =
	"test/sdd/passkey-runtime-finality.server-contract.target.test.ts";

export const SUPERSEDED_IDS = [
	"B-SRV-START-HASH",
	"B-SRV-START-NO-RAW",
	"B-SRV-CONSUME-NO-USER",
	"B-SRV-PERSIST-HASH",
] as const;
