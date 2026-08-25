/**
 * SUPERSEDED by test/sdd/passkey-authenticator-metadata.target.test.ts
 *
 * Former characterization of:
 * - B-JS-TYPES: AthenaPasskeyRecord optional string metadata; frozen aliases absent
 * - B-JS-SCHEMA: 005_create_passkey_table defaults singleDevice / false; no local routes
 * - B-JS-CAP: embedded snapshot fail-closes passkeys
 * - B-JS-SURFACE: athena.auth.passkey eight HTTP methods only
 * - B-RS-ADAPTER: PasskeyStoreAdapter::create_passkey hardcodes
 *   device_type=singleDevice, backed_up=false, transports=None
 * - B-RS-FLAGS: persist ignores BE/BS/transports; 0x41 fixtures cannot
 *   distinguish hardcode from a correct mapper
 *
 * Active baseline file deleted after implement: B-JS-TYPES inverted
 * (aliases landed). Target suite is the CI source of truth.
 *
 * Kept as a record only (not a *.test.ts file so CI does not run it).
 */
export const SUPERSEDED_BY =
	"test/sdd/passkey-authenticator-metadata.target.test.ts";

export const SUPERSEDED_IDS = [
	"B-JS-TYPES",
	"B-JS-SCHEMA",
	"B-JS-CAP",
	"B-JS-SURFACE",
	"B-RS-ADAPTER",
	"B-RS-FLAGS",
] as const;
