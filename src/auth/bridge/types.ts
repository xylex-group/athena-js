export type AuthBridgeConsumeReason =
	| "consumed"
	| "destination_mismatch"
	| "session_revoked";

export interface IssueAuthBridgeCodeInput {
	codeHash: string;
	destinationOrigin: string;
	expiresAt: Date;
	id?: string;
	organizationId?: string | null;
	redirectPath: string;
	sessionId: string;
	userId: string;
}

export interface AuthBridgeCodeRecord {
	codeHash: string;
	consumeReason: AuthBridgeConsumeReason | null;
	consumedAt: Date | null;
	createdAt: Date;
	destinationOrigin: string;
	expiresAt: Date;
	id: string;
	organizationId: string | null;
	redirectPath: string;
	sessionId: string;
	userId: string;
}

export interface ConsumeAuthBridgeCodeInput {
	code: string;
	destinationOrigin: string;
}

export interface ConsumedBridgeCode {
	consumedAt: Date;
	destinationOrigin: string;
	organizationId: string | null;
	redirectPath: string;
	sessionId: string;
	userId: string;
}

export interface ParsedAuthBridgeCode {
	bytes: Uint8Array;
	entropyBits: number;
}
