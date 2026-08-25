import type {
	AuthBridgeCodeRecord,
	ConsumeAuthBridgeCodeInput,
	ConsumedBridgeCode,
	IssueAuthBridgeCodeInput,
} from "./types.ts";

export interface AuthBridgeCodeStore {
	consume(input: ConsumeAuthBridgeCodeInput): Promise<ConsumedBridgeCode | null>;
	deleteExpired(now?: Date): Promise<number>;
	issue(input: IssueAuthBridgeCodeInput): Promise<AuthBridgeCodeRecord>;
	revokeForSession(sessionId: string, reason?: string): Promise<number>;
}
