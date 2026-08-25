import { hashAuthBridgeCode } from "../../bridge/code.ts";
import type { AuthBridgeCodeStore } from "../../bridge/store.ts";
import type {
	AuthBridgeCodeRecord,
	AuthBridgeConsumeReason,
	ConsumeAuthBridgeCodeInput,
	ConsumedBridgeCode,
	IssueAuthBridgeCodeInput,
} from "../../bridge/types.ts";

type MemoryBridgeRow = AuthBridgeCodeRecord;

function cloneRecord(row: MemoryBridgeRow): AuthBridgeCodeRecord {
	return {
		codeHash: row.codeHash,
		consumeReason: row.consumeReason,
		consumedAt: row.consumedAt ? new Date(row.consumedAt) : null,
		createdAt: new Date(row.createdAt),
		destinationOrigin: row.destinationOrigin,
		expiresAt: new Date(row.expiresAt),
		id: row.id,
		organizationId: row.organizationId,
		redirectPath: row.redirectPath,
		sessionId: row.sessionId,
		userId: row.userId,
	};
}

function isOutstanding(row: MemoryBridgeRow, now: Date): boolean {
	return row.consumedAt === null && row.expiresAt.getTime() > now.getTime();
}

export function createMemoryAuthBridgeCodeStore(): AuthBridgeCodeStore {
	const rows = new Map<string, MemoryBridgeRow>();
	let chain: Promise<unknown> = Promise.resolve();

	const withLock = <T>(fn: () => Promise<T>): Promise<T> => {
		const run = chain.then(fn, fn);
		chain = run.then(
			() => undefined,
			() => undefined,
		);
		return run;
	};

	return {
		async issue(input: IssueAuthBridgeCodeInput): Promise<AuthBridgeCodeRecord> {
			const record: MemoryBridgeRow = {
				codeHash: input.codeHash,
				consumeReason: null,
				consumedAt: null,
				createdAt: new Date(),
				destinationOrigin: input.destinationOrigin,
				expiresAt: new Date(input.expiresAt),
				id: input.id ?? crypto.randomUUID(),
				organizationId: input.organizationId ?? null,
				redirectPath: input.redirectPath,
				sessionId: input.sessionId,
				userId: input.userId,
			};
			rows.set(record.codeHash, record);
			return cloneRecord(record);
		},

		consume(input: ConsumeAuthBridgeCodeInput): Promise<ConsumedBridgeCode | null> {
			return withLock(async () => {
				const now = new Date();
				const codeHash = await hashAuthBridgeCode(input.code);
				const row = rows.get(codeHash);
				if (!row || !isOutstanding(row, now)) {
					return null;
				}
				if (row.destinationOrigin !== input.destinationOrigin) {
					row.consumedAt = now;
					row.consumeReason = "destination_mismatch";
					return null;
				}
				row.consumedAt = now;
				row.consumeReason = "consumed";
				return {
					consumedAt: new Date(now),
					destinationOrigin: row.destinationOrigin,
					organizationId: row.organizationId,
					redirectPath: row.redirectPath,
					sessionId: row.sessionId,
					userId: row.userId,
				};
			});
		},

		async revokeForSession(sessionId: string, _reason?: string): Promise<number> {
			const now = new Date();
			const consumeReason: AuthBridgeConsumeReason = "session_revoked";
			let count = 0;
			for (const row of rows.values()) {
				if (row.sessionId !== sessionId || !isOutstanding(row, now)) {
					continue;
				}
				row.consumedAt = now;
				row.consumeReason = consumeReason;
				count += 1;
			}
			return count;
		},

		async deleteExpired(now = new Date()): Promise<number> {
			let count = 0;
			for (const [hash, row] of rows) {
				if (row.expiresAt.getTime() > now.getTime()) {
					continue;
				}
				rows.delete(hash);
				count += 1;
			}
			return count;
		},
	};
}
