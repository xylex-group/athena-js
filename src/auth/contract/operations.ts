/**
 * Shared Athena Auth operation contract.
 *
 * Live HTTP support is generated (`operations.generated.ts` /
 * `contracts/auth/routes.generated.json`). This module owns the type and
 * derived views. Do not hand-maintain a second missing-route list.
 */

import type { AthenaAuthDomainEvent } from "../hooks/events.ts";

export type AthenaAuthRuntimeSupport = "supported" | "unsupported";

export type AthenaAuthOperationAuth =
	| "public"
	| "optional-session"
	| "session"
	| "admin";

export type AthenaAuthOperationCapability =
	| "accounts"
	| "admin"
	| "apiKeys"
	| "email"
	| "health"
	| "invitations"
	| "jwt"
	| "oidc"
	| "organizations"
	| "passkeys"
	| "password"
	| "sessions"
	| "social"
	| "tokens"
	| "twoFactor";

export interface AthenaAuthOperationDefinition {
	id: string;
	method: string;
	path: string;
	capability: AthenaAuthOperationCapability | string;
	rust: AthenaAuthRuntimeSupport;
	embedded: AthenaAuthRuntimeSupport;
	auth: AthenaAuthOperationAuth;
	mutation: boolean;
	domainEvent?: AthenaAuthDomainEvent;
	nonportable?: boolean;
}

export function operationKey(
	operation: Pick<AthenaAuthOperationDefinition, "method" | "path">,
): string {
	return `${operation.method} ${operation.path}`;
}

/**
 * Product-portable gaps: Rust serves the route, embedded does not, and the
 * route is not a dedicated-service operator surface (`nonportable`).
 *
 * Wave 0 keeps `KNOWN_MISSING_IN_LOCAL` as a freeze snapshot of this list.
 * Later waves delete the Set once this function returns [].
 */
export function listMissingEmbeddedOperations(
	operations: readonly AthenaAuthOperationDefinition[],
): string[] {
	return operations
		.filter(
			(operation) =>
				operation.rust === "supported" &&
				operation.embedded === "unsupported" &&
				operation.nonportable !== true,
		)
		.map(operationKey)
		.sort();
}

export function operationsForCapability(
	operations: readonly AthenaAuthOperationDefinition[],
	capability: string,
): AthenaAuthOperationDefinition[] {
	return operations.filter((operation) => operation.capability === capability);
}

/**
 * Advertised `passkeys` / social providers must stay false until every
 * portable Rust-supported operation in that capability is embedded-supported.
 */
export function deriveEmbeddedCapabilityAdvertisement(
	operations: readonly AthenaAuthOperationDefinition[],
): {
	passkeys: boolean;
	socialProvidersAdvertised: boolean;
} {
	const portable = (capability: string) =>
		operations.filter(
			(operation) =>
				operation.capability === capability &&
				operation.rust === "supported" &&
				operation.nonportable !== true,
		);

	const passkeyOps = portable("passkeys");
	const socialOps = portable("social");

	return {
		passkeys:
			passkeyOps.length > 0 &&
			passkeyOps.every((operation) => operation.embedded === "supported"),
		socialProvidersAdvertised:
			socialOps.length > 0 &&
			socialOps.every((operation) => operation.embedded === "supported"),
	};
}
