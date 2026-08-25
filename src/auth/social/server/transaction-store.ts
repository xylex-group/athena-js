import type { OAuthTransactionIntent } from "./types.ts";

export type { OAuthTransactionIntent };

export interface OAuthTransactionRecord {
	codeChallengeMethod: "S256";
	createdAt: Date;
	expiresAt: Date;
	id: string;
	intent: OAuthTransactionIntent;
	nonceHash: string;
	pkceVerifierCiphertext: string;
	providerId: string;
	redirectUri: string;
	stateHash: string;
	userId: string | null;
}

export interface OAuthTransactionStore {
	consume(stateHash: string): Promise<OAuthTransactionRecord | null>;
	create(row: OAuthTransactionRecord): Promise<void>;
	expire(now?: Date): Promise<number>;
}

export async function sha256Hex(value: string): Promise<string> {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(value),
	);
	return Buffer.from(digest).toString("hex");
}
