import type {
	AthenaAuthMutationScope,
	AuthMutationTransaction,
} from "../hooks/scope.ts";
import {
	insertAuditLogAuth,
	type MemoryAuthAuditSink,
} from "../observability/audit.ts";
import {
	MemoryAdminAuthStore,
	PostgresAdminAuthStore,
} from "./admin-store.ts";
import type { AthenaAuthDatabase } from "./database.ts";
import { MemoryAuthStores } from "./memory-stores.ts";
import { PostgresAuthStores } from "./stores.ts";

interface MemoryStoreSnapshot {
	accounts: MemoryAuthStores["accounts"];
	apiKeys: MemoryAuthStores["apiKeys"];
	invitations: MemoryAuthStores["invitations"];
	members: MemoryAuthStores["members"];
	organizations: MemoryAuthStores["organizations"];
	passkeys: MemoryAuthStores["passkeys"];
	passkeyRegistrationTransactions: MemoryAuthStores["passkeyRegistrationTransactions"];
	sessions: MemoryAuthStores["sessions"];
	twoFactors: MemoryAuthStores["twoFactors"];
	users: MemoryAuthStores["users"];
	verifications: MemoryAuthStores["verifications"];
}

function cloneMap<K, V>(source: Map<K, V>): Map<K, V> {
	return new Map(
		[...source.entries()].map(([key, value]) => [key, structuredClone(value)]),
	);
}

function snapshotMemoryStores(stores: MemoryAuthStores): MemoryStoreSnapshot {
	return {
		accounts: cloneMap(stores.accounts),
		apiKeys: cloneMap(stores.apiKeys),
		invitations: cloneMap(stores.invitations),
		members: cloneMap(stores.members),
		organizations: cloneMap(stores.organizations),
		passkeys: cloneMap(stores.passkeys),
		passkeyRegistrationTransactions: cloneMap(
			stores.passkeyRegistrationTransactions,
		),
		sessions: cloneMap(stores.sessions),
		twoFactors: cloneMap(stores.twoFactors),
		users: cloneMap(stores.users),
		verifications: cloneMap(stores.verifications),
	};
}

function restoreMemoryStores(
	stores: MemoryAuthStores,
	snapshot: MemoryStoreSnapshot,
): void {
	replaceMap(stores.accounts, snapshot.accounts);
	replaceMap(stores.apiKeys, snapshot.apiKeys);
	replaceMap(stores.invitations, snapshot.invitations);
	replaceMap(stores.members, snapshot.members);
	replaceMap(stores.organizations, snapshot.organizations);
	replaceMap(stores.passkeys, snapshot.passkeys);
	replaceMap(
		stores.passkeyRegistrationTransactions,
		snapshot.passkeyRegistrationTransactions,
	);
	replaceMap(stores.sessions, snapshot.sessions);
	replaceMap(stores.twoFactors, snapshot.twoFactors);
	replaceMap(stores.users, snapshot.users);
	replaceMap(stores.verifications, snapshot.verifications);
}

function replaceMap<K, V>(target: Map<K, V>, source: Map<K, V>): void {
	target.clear();
	for (const [key, value] of source) {
		target.set(key, structuredClone(value));
	}
}

export function createMemoryAuthMutationTransaction(
	stores: MemoryAuthStores,
	admin = new MemoryAdminAuthStore(stores),
	auditSink?: MemoryAuthAuditSink,
): AuthMutationTransaction {
	let queue: Promise<unknown> = Promise.resolve();
	return async <T>(fn: (scope: AthenaAuthMutationScope) => Promise<T>) => {
		const run = async () => {
			const snapshot = snapshotMemoryStores(stores);
			const auditSnapshot = auditSink ? auditSink.entries.slice() : undefined;
			try {
				return await fn({ admin, stores });
			} catch (error) {
				restoreMemoryStores(stores, snapshot);
				if (auditSink && auditSnapshot) {
					auditSink.entries.splice(
						0,
						auditSink.entries.length,
						...auditSnapshot,
					);
				}
				throw error;
			}
		};
		const next = queue.then(run, run);
		queue = next.then(
			() => undefined,
			() => undefined,
		);
		return next;
	};
}

export function createPostgresAuthMutationTransaction(
	database: AthenaAuthDatabase,
	persistAudit = false,
): AuthMutationTransaction {
	return async <T>(fn: (scope: AthenaAuthMutationScope) => Promise<T>) =>
		database.transaction(async (txDb) =>
			fn({
				admin: new PostgresAdminAuthStore(txDb),
				persistAudit: persistAudit
					? (entry) => insertAuditLogAuth(txDb, entry)
					: undefined,
				stores: new PostgresAuthStores(txDb),
			}),
		);
}

export function createAuthMutationTransaction(input: {
	auditSink?: MemoryAuthAuditSink;
	database?: AthenaAuthDatabase;
	persistAudit?: boolean;
	stores: MemoryAuthStores | PostgresAuthStores;
}): AuthMutationTransaction {
	if (input.database) {
		return createPostgresAuthMutationTransaction(
			input.database,
			input.persistAudit === true,
		);
	}
	if (input.stores instanceof MemoryAuthStores) {
		return createMemoryAuthMutationTransaction(
			input.stores,
			undefined,
			input.auditSink,
		);
	}
	throw new Error(
		"Auth mutation transactions require a database or MemoryAuthStores",
	);
}
