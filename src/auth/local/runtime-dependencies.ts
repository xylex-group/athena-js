import type { AuthBridgeCodeStore } from "../bridge/store.ts";
import type { AthenaEmailDeliveryPort } from "../../email/types.ts";
import {
	type NormalizedAthenaAuthConfig,
	normalizeAthenaAuthConfig,
} from "../config.ts";
import type { AthenaAuthImplementedDomainEvent } from "../hooks/events.ts";
import type { ExecuteAuthMutationOptions } from "../hooks/execute.ts";
import { executeAuthMutation } from "../hooks/execute.ts";
import type { AuthMutationTransaction } from "../hooks/scope.ts";
import {
	type AthenaAuthAuditWriter,
	createMemoryAuthAuditWriter,
	createPostgresAuthAuditWriter,
	type MemoryAuthAuditSink,
} from "../observability/audit.ts";
import { normalizeAthenaAuthObservability } from "../observability/config.ts";
import {
	createPasskeyRelyingPartyResolver,
	createPasskeyRelyingPartySnapshot,
	type PasskeyRelyingPartyResolver,
} from "../passkey/server/relying-party.ts";
import type { AthenaPasskeyRelyingParty } from "../passkey/server/types.ts";
import { isUserEffectivelyBanned } from "./admin-contract.ts";
import {
	createSessionCookieHeader,
	readBearerToken,
	readSessionTokenFromCookies,
	shouldSetSecureCookie,
} from "./cookies.ts";
import { createMemoryAuthBridgeCodeStore } from "./bridge/memory-store.ts";
import { createPostgresAuthBridgeCodeStore } from "./bridge/postgres-store.ts";
import {
	type AthenaAuthDatabase,
	createPostgresAuthDatabase,
} from "./database.ts";
import { PostgresAuthEmailStore } from "./email/postgres-store.ts";
import {
	type AthenaAuthEmailStore,
	MemoryAuthEmailStore,
} from "./email/store.ts";
import { emitAuthEmail } from "../email/index.ts";
import { AthenaAuthRuntimeError } from "./errors.ts";
import { resolveRuntimeKey } from "./keyring.ts";
import { type AthenaAuthStores, MemoryAuthStores } from "./memory-stores.ts";
import type { AuthSessionRow, AuthUserRow } from "./models.ts";
import { createAuthMutationTransaction } from "./mutation-transaction.ts";
import {
	type AthenaAuthPasswordHasher,
	createArgon2PasswordHasher,
} from "./password.ts";
import { instrumentAuthStoreMethods, timeAuthSpan } from "./request-timing.ts";
import {
	assertAthenaAuthSchemaCompatible,
	migrateAthenaAuthSchema,
} from "./schema.ts";
import { MemoryRateLimiter, requestClientIp } from "./security.ts";
import { PostgresAuthStores } from "./stores.ts";
import { createLocalTokenAuthority } from "./token-authority.ts";
import { createSessionToken } from "./runtime-helpers.ts";
import type { CreateAthenaAuthRuntimeOptions } from "./runtime-types.ts";
import {
	type AthenaEmbeddedSocialRuntime,
	composeEmbeddedSocialRuntime,
	resolveSocialEncryptionSecret,
} from "./social/runtime.ts";

export type AuthRuntimeTokenAuthority = Awaited<
	ReturnType<typeof createLocalTokenAuthority>
>;

export type AuthRuntimeMutate = <
	E extends AthenaAuthImplementedDomainEvent,
	TResult,
>(
	input: Omit<
		ExecuteAuthMutationOptions<E, TResult>,
		"auditWriter" | "hooks" | "transaction"
	>,
) => Promise<TResult>;

export type AuthRuntimeEmitMail = (
	input: Parameters<typeof emitAuthEmail>[0],
) => ReturnType<typeof emitAuthEmail>;

export interface AuthRuntimeDependencies {
	bridgeCodeStore: AuthBridgeCodeStore;
	close(): Promise<void>;
	config: NormalizedAthenaAuthConfig;
	emitIfRecipient: (
		recipient: string | null | undefined,
		input: Omit<Parameters<typeof emitAuthEmail>[0], "recipient">,
	) => Promise<void>;
	emitMail: AuthRuntimeEmitMail;
	ensureReady(): Promise<AthenaAuthStores>;
	getConnectionString(): string | undefined;
	getDatabase(): AthenaAuthDatabase | undefined;
	getBridgeCodeStore(): AuthBridgeCodeStore;
	getDelivery(): AthenaEmailDeliveryPort | undefined;
	getEmailStore(): AthenaAuthEmailStore;
	getTokenAuthority(): AuthRuntimeTokenAuthority | undefined;
	getSocialRuntime(): Promise<AthenaEmbeddedSocialRuntime | null>;
	hasher: AthenaAuthPasswordHasher;
	hookRequest: (
		request: Request,
		path: string,
	) => {
		ipAddress?: string;
		method: string;
		path: string;
		userAgent?: string;
	};
	hooksRef?: CreateAthenaAuthRuntimeOptions["hooks"];
	identityOf: (user?: {
		email?: string | null;
		id: string;
		name?: string | null;
	}) => string;
	issueSession: (
		request: Request,
		currentStores: AthenaAuthStores,
		userId: string,
		headers: Headers,
	) => Promise<AuthSessionRow>;
	migrate(): Promise<void>;
	mutate: AuthRuntimeMutate;
	observability: ReturnType<typeof normalizeAthenaAuthObservability>;
	ownsDatabase: boolean;
	passkeyOnboarding?: CreateAthenaAuthRuntimeOptions["passkeyOnboarding"];
	passkeyRelyingParty?: AthenaPasskeyRelyingParty;
	passkeyResolver?: PasskeyRelyingPartyResolver;
	rateLimiter: MemoryRateLimiter;
	requireSession: (
		request: Request,
		currentStores: AthenaAuthStores,
	) => Promise<{
		session: AuthSessionRow;
		token: string;
		user: AuthUserRow;
	}>;
	resolveSession: (
		request: Request,
		currentStores: AthenaAuthStores,
	) => Promise<{
		session: AuthSessionRow;
		token: string;
		user: AuthUserRow;
	} | null>;
	setDatabase(next: AthenaAuthDatabase | undefined): void;
	setDelivery(next: AthenaEmailDeliveryPort | undefined): void;
	setTokenAuthority(next: AuthRuntimeTokenAuthority | undefined): void;
}

export function createRuntimeDependencies(
	options: CreateAthenaAuthRuntimeOptions = {},
): AuthRuntimeDependencies {
	const config =
		options.config ??
		normalizeAthenaAuthConfig({
			basePath: options.basePath,
			mode: "local",
			secret: options.secret,
		});
	const passkeyEnvironment =
		process.env.NODE_ENV === "production" ? "production" : "development";
	let passkeyRelyingParty: AthenaPasskeyRelyingParty | undefined;
	let passkeyResolver: PasskeyRelyingPartyResolver | undefined;
	if (passkeyEnvironment === "development" || config.passkeyConfigured) {
		passkeyRelyingParty = createPasskeyRelyingPartySnapshot({
			appIdentity: config.appIdentity,
			environment: passkeyEnvironment,
			passkey: config.passkey,
			required: config.passkey.enabled,
			trustedOrigins: config.security.trustedOrigins,
		});
		passkeyResolver = createPasskeyRelyingPartyResolver(passkeyRelyingParty);
	}
	const hasher = options.hasher ?? createArgon2PasswordHasher();
	const rateLimiter = new MemoryRateLimiter(20, 60_000);
	const hasExternalDatabase = Boolean(options.database);
	const rawMemoryStores =
		options.stores ?? (options.database ? undefined : new MemoryAuthStores());
	const memoryStores =
		rawMemoryStores && !hasExternalDatabase
			? instrumentAuthStoreMethods(rawMemoryStores)
			: rawMemoryStores;
	let database: AthenaAuthDatabase | undefined =
		typeof options.database === "string" ? undefined : options.database;
	const connectionString =
		typeof options.database === "string" ? options.database : undefined;
	let stores: AthenaAuthStores | undefined = memoryStores;
	let runtimeKeyMaterial: string | undefined;
	let ready: Promise<void> | undefined;
	const ownsDatabase = typeof options.database === "string";
	let emailStore: AthenaAuthEmailStore = new MemoryAuthEmailStore();
	const memoryBridgeCodeStore = createMemoryAuthBridgeCodeStore();
	let postgresBridgeCodeStore: AuthBridgeCodeStore | undefined;
	let delivery = options.delivery;
	let tokenAuthority:
		| Awaited<ReturnType<typeof createLocalTokenAuthority>>
		| undefined;
	const emitMail = (input: Parameters<typeof emitAuthEmail>[0]) =>
		emitAuthEmail(input, {
			get store() {
				return emailStore;
			},
			get delivery() {
				return delivery;
			},
			legacySend: options.legacySend,
		});
	const identityOf = (user?: {
		email?: string | null;
		id: string;
		name?: string | null;
	}) => user?.email ?? user?.name ?? user?.id ?? "member";
	const emitIfRecipient = async (
		recipient: string | null | undefined,
		input: Omit<Parameters<typeof emitAuthEmail>[0], "recipient">,
	) => {
		if (!recipient) {
			return;
		}
		await emitMail({ ...input, recipient });
	};

	const ensureReady = async (): Promise<AthenaAuthStores> => {
		if (!ready) {
			ready = (async () => {
				if (!stores) {
					if (!database) {
						if (!connectionString) {
							throw AthenaAuthRuntimeError.internal(
								new Error("Local Athena Auth requires a database"),
							);
						}
						database = await createPostgresAuthDatabase(connectionString);
					}
					if (options.autoMigrate === true) {
						await migrateAthenaAuthSchema(database);
					} else {
						await assertAthenaAuthSchemaCompatible(database);
					}
					const resolvedKey = await resolveRuntimeKey(
						database,
						options.secret ?? config.secret,
					);
					runtimeKeyMaterial = resolvedKey.material;
					stores = new PostgresAuthStores(database);
					emailStore = new PostgresAuthEmailStore(database);
					postgresBridgeCodeStore = createPostgresAuthBridgeCodeStore(database);
				}
			})();
		}
		await ready;
		if (!stores) {
			throw AthenaAuthRuntimeError.internal(
				new Error("Auth stores were not initialized"),
			);
		}
		return stores;
	};

	const observability =
		config.observability ?? normalizeAthenaAuthObservability();
	const auditSink: MemoryAuthAuditSink = { entries: [] };
	const resolveAuditWriter = (): AthenaAuthAuditWriter | undefined => {
		if (!observability.auditLog) {
			return undefined;
		}
		if (database) {
			return createPostgresAuthAuditWriter();
		}
		return createMemoryAuthAuditWriter(auditSink);
	};

	let mutationTransaction: AuthMutationTransaction | undefined;
	const ensureTransaction = async (): Promise<AuthMutationTransaction> => {
		const currentStores = await ensureReady();
		mutationTransaction ??= createAuthMutationTransaction({
			auditSink,
			database,
			persistAudit: observability.auditLog,
			stores: currentStores,
		});
		return mutationTransaction;
	};

	const hookRequest = (request: Request, path: string) => ({
		ipAddress:
			requestClientIp(request, config.security.trustedProxy) ?? undefined,
		method: request.method.toUpperCase(),
		path,
		userAgent: request.headers.get("user-agent") ?? undefined,
	});

	const mutate = async <E extends AthenaAuthImplementedDomainEvent, TResult = any>(
		input: Omit<
			ExecuteAuthMutationOptions<E, TResult>,
			"auditWriter" | "hooks" | "transaction"
		>,
	): Promise<TResult> =>
		executeAuthMutation({
			...input,
			auditWriter: resolveAuditWriter(),
			hooks: options.hooks,
			transaction: await ensureTransaction(),
		} as ExecuteAuthMutationOptions<E, TResult>);

	const resolveSession = async (
		request: Request,
		currentStores: AthenaAuthStores,
	): Promise<{
		session: AuthSessionRow;
		token: string;
		user: AuthUserRow;
	} | null> =>
		timeAuthSpan("session_lookup", async () => {
			const token =
				readBearerToken(request.headers.get("authorization")) ??
				readSessionTokenFromCookies(
					request.headers.get("cookie"),
					config.session.cookieName,
				);
			if (!token) {
				return null;
			}
			const session = await currentStores.getSessionByToken(token);
			if (!session) {
				return null;
			}
			const user = await timeAuthSpan("user_lookup", () =>
				currentStores.getUserById(session.user_id),
			);
			if (!user) {
				return null;
			}
			if (user.banned && !isUserEffectivelyBanned(user)) {
				await currentStores.updateUser(user.id, {
					banned: false,
					banExpires: null,
					banReason: null,
				});
				user.banned = false;
				user.ban_expires = null;
				user.ban_reason = null;
			} else if (isUserEffectivelyBanned(user)) {
				return null;
			}
			if (
				!config.session.disableSessionRefresh &&
				Date.now() - new Date(session.updated_at).getTime() >=
					config.session.updateAgeSeconds * 1000
			) {
				await timeAuthSpan("session_refresh", async () => {
					const expiresAt = new Date(
						Date.now() + config.session.expiresInSeconds * 1000,
					);
					await currentStores.updateSessionExpiry(token, expiresAt);
					session.expires_at = expiresAt;
					session.updated_at = new Date();
				});
			}
			return { session, token, user };
		});

	const requireSession = async (
		request: Request,
		currentStores: AthenaAuthStores,
	) => {
		const resolved = await resolveSession(request, currentStores);
		if (!resolved) {
			if (
				readBearerToken(request.headers.get("authorization")) ||
				readSessionTokenFromCookies(
					request.headers.get("cookie"),
					config.session.cookieName,
				)
			) {
				throw AthenaAuthRuntimeError.sessionNotFound();
			}
			throw AthenaAuthRuntimeError.unauthenticated();
		}
		return resolved;
	};

	const issueSession = async (
		request: Request,
		currentStores: AthenaAuthStores,
		userId: string,
		headers: Headers,
	) => {
		const expiresAt = new Date(
			Date.now() + config.session.expiresInSeconds * 1000,
		);
		const session = await currentStores.createSession({
			expiresAt,
			id: crypto.randomUUID(),
			ipAddress: requestClientIp(request, config.security.trustedProxy),
			token: createSessionToken(),
			userAgent: request.headers.get("user-agent"),
			userId,
		});
		await currentStores.updateUser(userId, { lastSignInAt: new Date() });
		headers.append(
			"set-cookie",
			createSessionCookieHeader(session.token, {
				cookieName: config.session.cookieName,
				expiresAt,
				secure: shouldSetSecureCookie(request, config.security.cookieSecure),
			}),
		);
		return session;
	};

	const resolveBridgeCodeStore = async (): Promise<AuthBridgeCodeStore> => {
		if (memoryStores && !hasExternalDatabase && !connectionString) {
			return memoryBridgeCodeStore;
		}
		await ensureReady();
		if (!postgresBridgeCodeStore) {
			const db = database;
			if (!db) {
				throw AthenaAuthRuntimeError.internal(
					new Error(
						"Database-backed Auth runtime requires a Postgres bridge code store",
					),
				);
			}
			postgresBridgeCodeStore = createPostgresAuthBridgeCodeStore(db);
		}
		return postgresBridgeCodeStore;
	};

	let socialRuntime: AthenaEmbeddedSocialRuntime | null | undefined;
	const getSocialRuntime = async (): Promise<AthenaEmbeddedSocialRuntime | null> => {
		if (socialRuntime !== undefined) {
			return socialRuntime;
		}
		await ensureReady();
		socialRuntime = composeEmbeddedSocialRuntime({
			database,
			secret: resolveSocialEncryptionSecret({
				configSecret: config.secret,
				explicitSecret: options.secret,
				runtimeKeyMaterial,
			}),
			social: config.social,
		});
		return socialRuntime;
	};

	const bridgeCodeStore: AuthBridgeCodeStore = {
		consume: async (input) => (await resolveBridgeCodeStore()).consume(input),
		deleteExpired: async (now) =>
			(await resolveBridgeCodeStore()).deleteExpired(now),
		issue: async (input) => (await resolveBridgeCodeStore()).issue(input),
		revokeForSession: async (sessionId, reason) =>
			(await resolveBridgeCodeStore()).revokeForSession(sessionId, reason),
	};

	return {
		bridgeCodeStore,
		close: async () => {
			if (ownsDatabase) {
				await database?.close?.();
			}
		},
		config,
		emitIfRecipient,
		emitMail,
		ensureReady,
		getBridgeCodeStore: () => bridgeCodeStore,
		getConnectionString: () => connectionString,
		getDatabase: () => database,
		getDelivery: () => delivery,
		getEmailStore: () => emailStore,
		getTokenAuthority: () => tokenAuthority,
		getSocialRuntime,
		hasher,
		hookRequest,
		hooksRef: options.hooks,
		identityOf,
		issueSession,
		migrate: async () => {
			if (!database) {
				if (!connectionString) {
					return;
				}
				database = await createPostgresAuthDatabase(connectionString);
			}
			await migrateAthenaAuthSchema(database);
		},
		mutate,
		observability,
		ownsDatabase,
		passkeyOnboarding: options.passkeyOnboarding,
		passkeyRelyingParty,
		passkeyResolver,
		rateLimiter,
		requireSession,
		resolveSession,
		setDatabase: (next) => {
			database = next;
		},
		setDelivery: (next) => {
			delivery = next;
		},
		setTokenAuthority: (next) => {
			tokenAuthority = next;
		},
	};
}
