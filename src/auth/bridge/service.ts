import { generateAuthBridgeCode, hashAuthBridgeCode } from "./code.ts";
import type { AuthBridgeCodeStore } from "./store.ts";
import type { AuthBridgeCodeRecord } from "./types.ts";

export interface IssueAuthBridgeCodeServiceInput {
	destinationOrigin: string;
	expiresAt: Date;
	organizationId?: string | null;
	redirectPath: string;
	sessionId: string;
	store: AuthBridgeCodeStore;
	userId: string;
}

export interface IssuedAuthBridgeCode {
	code: string;
	record: AuthBridgeCodeRecord;
}

export async function issueAuthBridgeCode(
	input: IssueAuthBridgeCodeServiceInput,
): Promise<IssuedAuthBridgeCode> {
	const code = generateAuthBridgeCode();
	const record = await input.store.issue({
		codeHash: await hashAuthBridgeCode(code),
		destinationOrigin: input.destinationOrigin,
		expiresAt: input.expiresAt,
		organizationId: input.organizationId,
		redirectPath: input.redirectPath,
		sessionId: input.sessionId,
		userId: input.userId,
	});
	return { code, record };
}
