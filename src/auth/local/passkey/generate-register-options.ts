/**
 * Local GET /passkey/generate-register-options.
 * Session: existing user ceremony. No session + onboarding: durable transaction.
 */
import {
	type AuthenticatorTransportFuture,
	generateRegistrationOptions,
} from "@simplewebauthn/server";

import type { NormalizedAthenaAuthConfig } from "../../config.ts";
import {
	registrationAuthenticatorSelection,
	supportedRegistrationExtensions,
	type AthenaPasskeyAuthenticatorAttachment,
} from "../../passkey/policy.ts";
import type {
	AthenaPasskeyRelyingParty,
	AthenaStoredPasskey,
} from "../../passkey/server/types.ts";
import type { AthenaPasskeyOptionsResponse } from "../../types.ts";
import { base64Url } from "../../utils/base64.ts";
import { AthenaAuthRuntimeError, jsonResponse } from "../errors.ts";
import type { AthenaAuthStores } from "../memory-stores.ts";
import type { AuthSessionRow, AuthUserRow } from "../models.ts";
import { createPasskeyChallengeStore } from "./challenge-store.ts";
import { createPasskeyRegistrationTransactionStore } from "./registration-transaction.ts";
import { createPasskeyRepository } from "./repository.ts";

const CHALLENGE_BYTES = 32;
const USER_HANDLE_BYTES = 32;

export interface GenerateRegisterOptionsContext {
	config: NormalizedAthenaAuthConfig;
	headers: Headers;
	relyingParty: AthenaPasskeyRelyingParty | undefined;
	resolveSession: (
		request: Request,
		stores: AthenaAuthStores,
	) => Promise<{
		session: AuthSessionRow;
		token: string;
		user: AuthUserRow;
	} | null>;
	stores: AthenaAuthStores;
}

function userLabel(user: AuthUserRow): {
	userDisplayName: string;
	userName: string;
} {
	const email = user.email?.trim() || undefined;
	const name = user.name?.trim() || undefined;
	return {
		userDisplayName: name ?? email ?? user.id,
		userName: email ?? name ?? user.id,
	};
}

function excludeCredentialsFromStored(
	rows: readonly AthenaStoredPasskey[],
): NonNullable<AthenaPasskeyOptionsResponse["excludeCredentials"]> {
	return rows.map((row) => {
		const id = base64Url.encode(row.credentialId, { padding: false });
		if (row.transports.length === 0) {
			return { id, type: "public-key" };
		}
		return {
			id,
			transports: [...row.transports],
			type: "public-key",
		};
	});
}

function toLooseExtensions(
	value: unknown,
): AthenaPasskeyOptionsResponse["extensions"] {
	if (value == null || typeof value !== "object" || Array.isArray(value)) {
		return undefined;
	}
	const record: NonNullable<AthenaPasskeyOptionsResponse["extensions"]> = {};
	for (const [key, entry] of Object.entries(value)) {
		record[key] = entry;
	}
	return record;
}

function toWireOptions(
	options: Awaited<ReturnType<typeof generateRegistrationOptions>>,
	rp: AthenaPasskeyRelyingParty,
	excludeCredentials: NonNullable<
		AthenaPasskeyOptionsResponse["excludeCredentials"]
	>,
): AthenaPasskeyOptionsResponse {
	return {
		attestation: options.attestation,
		authenticatorSelection: options.authenticatorSelection,
		challenge: options.challenge,
		excludeCredentials,
		extensions: toLooseExtensions(options.extensions),
		pubKeyCredParams: options.pubKeyCredParams,
		rp: { id: rp.id, name: rp.name },
		timeout: options.timeout,
		user: {
			displayName: options.user.displayName,
			id: options.user.id,
			name: options.user.name,
		},
	};
}

function queryAttachment(
	request: Request,
): AthenaPasskeyAuthenticatorAttachment | null {
	const attachment = new URL(request.url).searchParams
		.get("authenticatorAttachment")
		?.trim();
	if (attachment === "platform" || attachment === "cross-platform") {
		return attachment;
	}
	return null;
}

function queryText(request: Request, key: string): string | undefined {
	const value = new URL(request.url).searchParams.get(key)?.trim();
	return value || undefined;
}

export async function handleGenerateRegisterOptionsRoute(
	request: Request,
	path: string,
	method: string,
	ctx: GenerateRegisterOptionsContext,
): Promise<Response | undefined> {
	if (path === "/passkey/generate-register-options" && method === "GET") {
		const rp = ctx.relyingParty;
		if (!rp) {
			throw new AthenaAuthRuntimeError(
				500,
				"Passkey relying party snapshot is not configured",
				{ code: "ATHENA_RUNTIME_CONFIG_INVALID" },
			);
		}

		const session = await ctx.resolveSession(request, ctx.stores);
		if (
			!session &&
			(request.headers.get("authorization") || request.headers.get("cookie"))
		) {
			throw AthenaAuthRuntimeError.sessionNotFound();
		}
		const onboarding = !session && ctx.config.passkey.onboardingEnabled;
		if (!session && !onboarding) {
			throw AthenaAuthRuntimeError.unauthenticated();
		}

		const existing = session
			? await createPasskeyRepository(ctx.stores).listByUser(session.user.id)
			: [];
		const excludeCredentials = excludeCredentialsFromStored(existing);
		const labels = session
			? userLabel(session.user)
			: {
					userDisplayName:
						queryText(request, "name") ??
						queryText(request, "email") ??
						"Passkey",
					userName:
						queryText(request, "email") ??
						queryText(request, "name") ??
						"passkey",
				};
		const rawChallenge = crypto.getRandomValues(
			new Uint8Array(CHALLENGE_BYTES),
		);
		const challengeHash = new Uint8Array(
			await crypto.subtle.digest("SHA-256", rawChallenge),
		);
		const ttlSeconds = ctx.config.passkey.challengeTtlSeconds;
		const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
		const userHandle = session
			? new TextEncoder().encode(session.user.id)
			: crypto.getRandomValues(new Uint8Array(USER_HANDLE_BYTES));

		if (session) {
			await createPasskeyChallengeStore(ctx.stores).create({
				challengeHash,
				expiresAt,
				purpose: "registration",
				rpId: rp.id,
				userId: session.user.id,
			});
		} else {
			await createPasskeyRegistrationTransactionStore(ctx.stores).create({
				challengeHash,
				context: {
					email: queryText(request, "email"),
					name: queryText(request, "name"),
				},
				expiresAt,
				mode: "onboarding",
				rpId: rp.id,
				userHandle,
			});
		}

		const policy = ctx.config.passkey.registration;
		const authenticatorSelection = registrationAuthenticatorSelection({
			attachmentOverride: queryAttachment(request),
			policy,
		});
		const extensions =
			policy.extensions.credProps === false
				? { credProps: false }
				: supportedRegistrationExtensions(policy);
		const options = await generateRegistrationOptions({
			attestationType: "none",
			authenticatorSelection,
			challenge: rawChallenge,
			excludeCredentials: excludeCredentials.flatMap((item) => {
				if (!item.id) {
					return [];
				}
				const descriptor: {
					id: string;
					transports?: AuthenticatorTransportFuture[];
				} = { id: item.id };
				if (item.transports && item.transports.length > 0) {
					descriptor.transports = [
						...item.transports,
					] as AuthenticatorTransportFuture[];
				}
				return [descriptor];
			}),
			...(extensions ? { extensions } : {}),
			rpID: rp.id,
			rpName: rp.name,
			timeout: ttlSeconds * 1000,
			userDisplayName: labels.userDisplayName,
			userID: userHandle,
			userName: labels.userName,
		});

		const wire = toWireOptions(options, rp, excludeCredentials);
		if (policy.extensions.credProps === false) {
			const extensions = { ...wire.extensions };
			delete extensions.credProps;
			wire.extensions =
				Object.keys(extensions).length > 0 ? extensions : undefined;
		}

		return jsonResponse(
			200,
			wire,
			ctx.headers,
		);
	}
	return undefined;
}
