import {
	authorizationCodeRequest,
	createAuthorizationURL,
	generateCodeChallenge,
} from "../../oauth2/index.ts";
import {
	AthenaSocialOAuthProviderMixupError,
	AthenaSocialServerError,
} from "./errors.ts";
import { resolveSocialProvider } from "./provider-registry.ts";
import type { OAuthTransactionRecord } from "./transaction-store.ts";
import { sha256Hex } from "./transaction-store.ts";
import type {
	AthenaSocialServerEngine,
	AthenaSocialServerEnginePorts,
	SocialAuthorizationStartInput,
	SocialAuthorizationStartResult,
	SocialTransactionConsumeInput,
} from "./types.ts";

const PKCE_S256 = "S256";
const DEFAULT_TTL_MS = 10 * 60 * 1000;
const TEXT_ENCODER = new TextEncoder();

function randomToken(): string {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	return Buffer.from(bytes).toString("base64url");
}

async function deriveAesKey(secret: string): Promise<CryptoKey> {
	const material = await crypto.subtle.digest(
		"SHA-256",
		TEXT_ENCODER.encode(secret),
	);
	return crypto.subtle.importKey("raw", material, "AES-GCM", false, [
		"encrypt",
	]);
}

async function encryptPkceVerifierAtRest(
	verifier: string,
	secret: string,
): Promise<string> {
	const key = await deriveAesKey(secret);
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const sealed = await crypto.subtle.encrypt(
		{ name: "AES-GCM", iv },
		key,
		TEXT_ENCODER.encode(verifier),
	);
	const packed = new Uint8Array(iv.byteLength + sealed.byteLength);
	packed.set(iv);
	packed.set(new Uint8Array(sealed), iv.byteLength);
	return Buffer.from(packed).toString("base64url");
}

function resolvePkceMethod(input: SocialAuthorizationStartInput): string {
	return input.codeChallengeMethod ?? input.pkceMethod ?? PKCE_S256;
}

function resolveUserId(input: SocialAuthorizationStartInput): string | null {
	if (typeof input.userId === "string" && input.userId.trim()) {
		return input.userId.trim();
	}
	if (typeof input.user_id === "string" && input.user_id.trim()) {
		return input.user_id.trim();
	}
	return null;
}

export function createAthenaSocialServerEngine(
	ports: AthenaSocialServerEnginePorts,
): AthenaSocialServerEngine {
	const secret = ports.encryptionKey ?? ports.secret;
	const social = { providers: ports.social.providers ?? {} };

	async function startAuthorization(
		input: SocialAuthorizationStartInput,
	): Promise<SocialAuthorizationStartResult> {
		if (!secret) {
			throw new AthenaSocialServerError(
				"ATHENA_AUTH_OAUTH_ENCRYPTION_REQUIRED",
				"social OAuth engine requires encryptionKey or secret",
			);
		}
		if (input.intent !== "sign-in" && input.intent !== "link") {
			throw new AthenaSocialServerError(
				"ATHENA_AUTH_OAUTH_INTENT_INVALID",
				"OAuth transaction intent must be sign-in or link",
			);
		}
		const pkceMethod = resolvePkceMethod(input);
		if (pkceMethod !== PKCE_S256) {
			throw new AthenaSocialServerError(
				"ATHENA_AUTH_OAUTH_PKCE_S256_REQUIRED",
				`PKCE method must be S256, not ${pkceMethod} (plain rejected)`,
			);
		}
		const userId =
			input.intent === "link" ? resolveUserId(input) : null;
		if (input.intent === "link" && !userId) {
			throw new AthenaSocialServerError(
				"ATHENA_AUTH_OAUTH_LINK_USER_REQUIRED",
				"user_id is required for link intent",
			);
		}
		const verifier = input.codeVerifier?.trim() || randomToken();
		if (!verifier) {
			throw new AthenaSocialServerError(
				"ATHENA_AUTH_OAUTH_PKCE_VERIFIER_REQUIRED",
				"PKCE verifier is required for S256",
			);
		}
		const state = randomToken();
		let nonce = randomToken();
		while (nonce === state) {
			nonce = randomToken();
		}
		const [stateHash, nonceHash, challenge] = await Promise.all([
			sha256Hex(state),
			sha256Hex(nonce),
			generateCodeChallenge(verifier),
		]);
		if (stateHash === nonceHash) {
			throw new AthenaSocialServerError(
				"ATHENA_AUTH_OAUTH_NONCE_STATE_COLLISION",
				"OIDC nonce must be distinct from CSRF state",
			);
		}
		const provider = resolveSocialProvider(social, input.provider);
		const authorizationUrl = await provider.createAuthorizationURL({
			codeVerifier: verifier,
			redirectURI: input.redirectUri,
			state,
		});
		authorizationUrl.searchParams.set("nonce", nonce);
		authorizationUrl.searchParams.set("code_challenge_method", PKCE_S256);
		authorizationUrl.searchParams.set("code_challenge", challenge);
		const ciphertext = await encryptPkceVerifierAtRest(
			JSON.stringify({
				r: input.postAuthRedirect,
				v: verifier,
			}),
			secret,
		);
		const now = new Date();
		if (typeof ports.transactions.expire === "function") {
			await ports.transactions.expire(now);
		}
		await ports.transactions.create({
			codeChallengeMethod: PKCE_S256,
			createdAt: now,
			expiresAt: new Date(now.getTime() + DEFAULT_TTL_MS),
			id: crypto.randomUUID(),
			intent: input.intent,
			nonceHash,
			pkceVerifierCiphertext: ciphertext,
			providerId: input.provider,
			redirectUri: input.redirectUri,
			stateHash,
			userId,
		});
		const url = authorizationUrl.toString();
		return {
			authorizationURL: url,
			nonce,
			state,
			url,
		};
	}

	async function consumeTransaction(input: SocialTransactionConsumeInput) {
		const stateHash = await sha256Hex(String(input.state ?? ""));
		const row = (await ports.transactions.consume(stateHash)) as
			| OAuthTransactionRecord
			| null
			| undefined;
		if (!row) {
			throw new AthenaSocialServerError(
				"ATHENA_AUTH_OAUTH_TRANSACTION_NOT_FOUND",
				"OAuth transaction not found, expired, or already consumed",
			);
		}
		if (row.providerId !== input.provider) {
			throw new AthenaSocialOAuthProviderMixupError();
		}
		return row;
	}

	return {
		consume: consumeTransaction,
		consumeTransaction,
		startAuthorization,
	};
}

export {
	authorizationCodeRequest,
	createAuthorizationURL,
	generateCodeChallenge,
};
