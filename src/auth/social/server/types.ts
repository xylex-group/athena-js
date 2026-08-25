import type { NormalizedSocialAuthConfig } from "./social-config.ts";

export type OAuthTransactionIntent = "sign-in" | "link";

export type OAuthPkceMethod = "S256";

export interface SocialAuthorizationStartInput {
	codeChallengeMethod?: string;
	codeVerifier?: string;
	intent: OAuthTransactionIntent;
	pkceMethod?: string;
	postAuthRedirect?: string;
	provider: string;
	redirectUri: string;
	userId?: string;
	user_id?: string;
}

export interface SocialAuthorizationStartResult {
	authorizationURL: string;
	nonce: string;
	state: string;
	url: string;
}

export interface SocialTransactionConsumeInput {
	provider: string;
	state: string;
}

export interface AthenaSocialServerEnginePorts {
	encryptionKey?: string;
	secret?: string;
	social:
		| NormalizedSocialAuthConfig
		| { providers: NormalizedSocialAuthConfig["providers"] };
	transactions: {
		consume(stateHash: string): Promise<unknown>;
		create(row: unknown): Promise<void>;
		expire?(now?: Date): Promise<number>;
	};
}

export interface AthenaSocialServerEngine {
	consume(input: SocialTransactionConsumeInput): Promise<unknown>;
	consumeTransaction(input: SocialTransactionConsumeInput): Promise<unknown>;
	startAuthorization(
		input: SocialAuthorizationStartInput,
	): Promise<SocialAuthorizationStartResult>;
}
