import type { AthenaEmailDeliveryPort } from "../../email/types.ts";
import { tryParseAthenaRightKey } from "../../rights/key.ts";
import { createOAuthRuntimeJwtVerifier } from "../../runtime/authority/oauth-verifier.ts";
import { PostgresAuthorizationStore } from "../../runtime/authorization/postgres.ts";
import type { AthenaRuntimeJwtVerifier } from "../../runtime/data/principal.ts";
import { generateOpaqueSecret } from "../authorization-server/tokens.ts";
import type { AuthBridgeCodeStore } from "../bridge/store.ts";
import {
  type NormalizedAthenaAuthConfig,
  normalizeAthenaAuthConfig,
} from "../config.ts";
import { emitAuthEmail } from "../email/index.ts";
import type { AthenaAuthImplementedDomainEvent } from "../hooks/events.ts";
import type { ExecuteAuthMutationOptions } from "../hooks/execute.ts";
import { executeAuthMutation } from "../hooks/execute.ts";
import type {
  AthenaAuthMutationScope,
  AuthMutationTransaction,
} from "../hooks/scope.ts";
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
import {
  createAthenaAuthProtocolIdentity,
  joinAuthProtocolUrl,
  tryCreateAthenaAuthProtocolIdentity,
} from "../protocol-identity.ts";
import { isUserEffectivelyBanned } from "./admin-contract.ts";
import { AthenaTokenAuthority } from "./athena-token-authority.ts";
import type { IssueSessionAuthentication } from "./authentication-context.ts";
import {
  createMemoryOAuthAuthorizationServerState,
  createMemoryOAuthAuthorizationServerStores,
  type MemoryOAuthAuthorizationServerState,
} from "./authorization-server/memory-stores.ts";
import { createPostgresOAuthAuthorizationServerStores } from "./authorization-server/postgres-stores.ts";
import { OAuthAuthorizationServerService } from "./authorization-server/service.ts";
import type { OAuthAuthorizationServerStores } from "./authorization-server/store.ts";
import { createMemoryAuthBridgeCodeStore } from "./bridge/memory-store.ts";
import { createPostgresAuthBridgeCodeStore } from "./bridge/postgres-store.ts";
import { systemAuthClock } from "./clock.ts";
import {
  createSessionCookieHeader,
  readBearerToken,
  readSessionTokenFromCookies,
  shouldSetSecureCookie,
} from "./cookies.ts";
import {
  type AthenaAuthDatabase,
  createPostgresAuthDatabase,
} from "./database.ts";
import { PostgresAuthEmailStore } from "./email/postgres-store.ts";
import {
  type AthenaAuthEmailStore,
  MemoryAuthEmailStore,
} from "./email/store.ts";
import { AthenaAuthRuntimeError } from "./errors.ts";
import { resolveRuntimeKey } from "./keyring.ts";
import { MemoryAuthStores } from "./memory-stores.ts";
import type { AuthSessionRow, AuthUserRow } from "./models.ts";
import { createAuthMutationTransaction } from "./mutation-transaction.ts";
import { normalizeSessionActiveOrganization } from "./organization-invariants.ts";
import {
  type AthenaAuthPasswordHasher,
  createArgon2PasswordHasher,
} from "./password.ts";
import { PostgresTokenKeyStore } from "./postgres-token-key-store.ts";
import {
  type AuthProtocolRuntime,
  rebindProtocolRuntime,
} from "./protocol-runtime.ts";
import { instrumentAuthStoreMethods, timeAuthSpan } from "./request-timing.ts";
import { createSessionToken } from "./runtime-helpers.ts";
import type { CreateAthenaAuthRuntimeOptions } from "./runtime-types.ts";
import {
  assertAthenaAuthSchemaCompatible,
  migrateAthenaAuthSchema,
} from "./schema.ts";
import {
  MemoryRateLimiter,
  requestClientIp,
  StoreRateLimiter,
} from "./security.ts";
import {
  type AthenaEmbeddedSocialRuntime,
  composeEmbeddedSocialRuntime,
  resolveSocialEncryptionSecret,
} from "./social/runtime.ts";
import {
  applyAthenaAuthSqliteSchema,
  SqliteAuthStores,
} from "./sqlite-stores.ts";
import type { AthenaAuthStores } from "./store-contract.ts";
import { PostgresAuthStores } from "./stores.ts";
import { createLocalTokenAuthority } from "./token-authority.ts";
import {
  getOrCreateProcessTokenKeyStore,
  type TokenKeyStore,
} from "./token-key-store.ts";

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
  >
) => Promise<TResult>;

export type AuthRuntimeEmitMail = (
  input: Parameters<typeof emitAuthEmail>[0]
) => ReturnType<typeof emitAuthEmail>;

export interface AuthRuntimeDependencies {
  authorizationAssignmentsSupported: boolean;
  bridgeCodeStore: AuthBridgeCodeStore;
  close(): Promise<void>;
  config: NormalizedAthenaAuthConfig;
  emitIfRecipient: (
    recipient: string | null | undefined,
    input: Omit<Parameters<typeof emitAuthEmail>[0], "recipient">
  ) => Promise<void>;
  emitMail: AuthRuntimeEmitMail;
  ensureReady(): Promise<AthenaAuthStores>;
  getBridgeCodeStore(): AuthBridgeCodeStore;
  getConnectionString(): string | undefined;
  getDatabase(): AthenaAuthDatabase | undefined;
  getDelivery(): AthenaEmailDeliveryPort | undefined;
  getEmailStore(): AthenaAuthEmailStore;
  getOAuthRuntimeJwtVerifier(
    resource: string
  ): Promise<AthenaRuntimeJwtVerifier>;
  getOAuthStores(): Promise<OAuthAuthorizationServerStores>;
  getProtocolRuntime(): Promise<AuthProtocolRuntime>;
  getSocialRuntime(): Promise<AthenaEmbeddedSocialRuntime | null>;
  resolveIdentityConnectionCredential?: CreateAthenaAuthRuntimeOptions["resolveIdentityConnectionCredential"];
  getTokenAuthority(): AuthRuntimeTokenAuthority | undefined;
  getTokenKeyStore(issuer?: string): Promise<TokenKeyStore>;
  hasher: AthenaAuthPasswordHasher;
  hookRequest: (
    request: Request,
    path: string
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
    authentication: IssueSessionAuthentication
  ) => Promise<AuthSessionRow>;
  listOrganizationLifecycleAuditRows(input: {
    after?: { createdAt: string; eventId: string };
    limit: number;
    organizationId: string;
  }): Promise<{ hasMore: boolean; rows: Record<string, unknown>[] }>;
  migrate(): Promise<void>;
  mutate: AuthRuntimeMutate;
  oauthRateLimiter: StoreRateLimiter;
  observability: ReturnType<typeof normalizeAthenaAuthObservability>;
  otpRateLimiter: StoreRateLimiter;
  otpVerificationRateLimiter: StoreRateLimiter;
  ownsDatabase: boolean;
  passkeyOnboarding?: CreateAthenaAuthRuntimeOptions["passkeyOnboarding"];
  passkeyRelyingParty?: AthenaPasskeyRelyingParty;
  passkeyResolver?: PasskeyRelyingPartyResolver;
  rateLimiter: MemoryRateLimiter;
  requireSession: (
    request: Request,
    currentStores: AthenaAuthStores
  ) => Promise<{
    session: AuthSessionRow;
    token: string;
    user: AuthUserRow;
  }>;
  resolveSession: (
    request: Request,
    currentStores: AthenaAuthStores
  ) => Promise<{
    session: AuthSessionRow;
    token: string;
    user: AuthUserRow;
  } | null>;
  setDatabase(next: AthenaAuthDatabase | undefined): void;
  setDelivery(next: AthenaEmailDeliveryPort | undefined): void;
  setTokenAuthority(next: AuthRuntimeTokenAuthority | undefined): void;
  transaction<T>(
    fn: (scope: AthenaAuthMutationScope) => Promise<T>
  ): Promise<T>;
}

export function createRuntimeDependencies(
  options: CreateAthenaAuthRuntimeOptions = {}
): AuthRuntimeDependencies {
  const config =
    options.config ??
    normalizeAthenaAuthConfig(
      {
        basePath: options.basePath,
        mode: "local",
        secret: options.secret,
      },
      {
        app: options.app,
        env: options.env,
        identity: options.identity,
      }
    );
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
  const protocolEnvironment =
    process.env.NODE_ENV === "production" ? "production" : "development";
  const protocolIdentityInput = {
    appIdentity: config.appIdentity,
    authorizationServer: config.authorizationServer,
    basePath: config.basePath,
  };
  let protocolIdentity = config.authorizationServer.enabled
    ? createAthenaAuthProtocolIdentity({
        ...protocolIdentityInput,
        environment: protocolEnvironment,
      })
    : tryCreateAthenaAuthProtocolIdentity(protocolIdentityInput);
  const rejectProductionEphemeralTokenKeys = (): never => {
    throw new AthenaAuthRuntimeError(
      500,
      "Persistent JWT signing requires PostgreSQL TokenKeyStore",
      { code: "ATHENA_AUTH_TOKEN_STORE_REQUIRED" }
    );
  };
  const requireProtocolIdentity = () => {
    if (protocolIdentity) {
      return protocolIdentity;
    }
    if (protocolEnvironment !== "production") {
      protocolIdentity = createAthenaAuthProtocolIdentity({
        ...protocolIdentityInput,
        environment: "development",
      });
      return protocolIdentity;
    }
    throw new AthenaAuthRuntimeError(
      500,
      "Athena Auth protocol identity requires authorizationServer.issuer or app.url/APP_URL",
      { code: "ATHENA_RUNTIME_CONFIG_INVALID" }
    );
  };
  const rateLimiter = new MemoryRateLimiter(20, 60_000);
  const hasExternalDatabase = Boolean(options.database);
  const rawMemoryStores =
    options.stores ?? (options.database ? undefined : new MemoryAuthStores());
  const authorizationAssignmentsSupported =
    !(rawMemoryStores instanceof SqliteAuthStores);
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
  let oauthStores: OAuthAuthorizationServerStores | undefined;
  const oauthMemoryState: MemoryOAuthAuthorizationServerState | undefined =
    memoryStores && !hasExternalDatabase && !connectionString
      ? createMemoryOAuthAuthorizationServerState()
      : undefined;
  let delivery = options.delivery;
  const clock = options.clock ?? systemAuthClock;
  let protocolRuntime: AuthProtocolRuntime | undefined;
  let ephemeralStateSecret: string | undefined;
  let tokenAuthority:
    | Awaited<ReturnType<typeof createLocalTokenAuthority>>
    | undefined;
  let tokenKeyStore: TokenKeyStore | undefined;
  const emitMail = (input: Parameters<typeof emitAuthEmail>[0]) =>
    emitAuthEmail(input, {
      defaultFrom: options.emailDefaultsFrom,
      defaultFromName: options.emailDefaultsFromName,
      get delivery() {
        return delivery;
      },
      legacySend: options.legacySend,
      get store() {
        return emailStore;
      },
    });
  const identityOf = (user?: {
    email?: string | null;
    id: string;
    name?: string | null;
  }) => user?.email ?? user?.name ?? user?.id ?? "member";
  const emitIfRecipient = async (
    recipient: string | null | undefined,
    input: Omit<Parameters<typeof emitAuthEmail>[0], "recipient">
  ) => {
    if (!recipient) {
      return;
    }
    await emitMail({ ...input, recipient });
  };

  const isRetryableAuthReadyFailure = (error: unknown): boolean =>
    error instanceof AthenaAuthRuntimeError &&
    (error.code === "ATHENA_AUTH_DATABASE_TIMEOUT" ||
      error.code === "ATHENA_AUTH_LEDGER_UNREACHABLE");

  const ensureReady = async (): Promise<AthenaAuthStores> => {
    if (!ready) {
      const initialization = (async () => {
        if (!stores) {
          if (!database) {
            if (!connectionString) {
              throw AthenaAuthRuntimeError.internal(
                new Error("Local Athena Auth requires a database")
              );
            }
            database = await createPostgresAuthDatabase(connectionString);
          }
          if (options.autoMigrate === true) {
            await migrateAthenaAuthSchema(database);
          } else {
            await assertAthenaAuthSchemaCompatible(database, {
              inspectSchema: true,
            });
          }
          await new PostgresAuthorizationStore(database).ensureCatalog();
          const resolvedKey = await resolveRuntimeKey(
            database,
            options.secret ?? config.secret
          );
          runtimeKeyMaterial = resolvedKey.material;
          stores = new PostgresAuthStores(database);
          emailStore = new PostgresAuthEmailStore(database);
          postgresBridgeCodeStore = createPostgresAuthBridgeCodeStore(database);
        }
      })();
      ready = initialization;
      void initialization.catch((error: unknown) => {
        if (isRetryableAuthReadyFailure(error) && ready === initialization) {
          ready = undefined;
        }
      });
    }
    await ready;
    if (!stores) {
      throw AthenaAuthRuntimeError.internal(
        new Error("Auth stores were not initialized")
      );
    }
    return stores;
  };
  const otpRateLimiter = new StoreRateLimiter(() => stores, 3, 60_000);
  const otpVerificationRateLimiter = new StoreRateLimiter(
    () => stores,
    5,
    5 * 60_000
  );
  const oauthRateLimiter = new StoreRateLimiter(() => stores, 20, 60_000);

  const observability =
    config.observability ?? normalizeAthenaAuthObservability();
  const auditSink: MemoryAuthAuditSink = { entries: [] };
  const resolveAuditWriter = (): AthenaAuthAuditWriter | undefined => {
    if (!observability.auditLog) {
      return;
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
      oauthState: oauthMemoryState,
      persistAudit: observability.auditLog,
      stores: currentStores,
      tokenKeyOptions: () => {
        const identity = protocolIdentity;
        if (!(identity && runtimeKeyMaterial)) {
          return;
        }
        return {
          encryptionSecret: runtimeKeyMaterial,
          issuer: identity.issuer,
        };
      },
      tokenKeys: () => {
        const identity = protocolIdentity;
        if (
          !(
            identity &&
            memoryStores &&
            !hasExternalDatabase &&
            !connectionString
          )
        ) {
          return;
        }
        if (protocolEnvironment === "production") {
          rejectProductionEphemeralTokenKeys();
        }
        return getOrCreateProcessTokenKeyStore(identity.issuer);
      },
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

  const mutate = async <
    E extends AthenaAuthImplementedDomainEvent,
    // biome-ignore lint/suspicious/noExplicitAny: mutation result type is event-specific
    TResult = any,
  >(
    input: Omit<
      ExecuteAuthMutationOptions<E, TResult>,
      "auditWriter" | "hooks" | "transaction"
    >
  ): Promise<TResult> =>
    executeAuthMutation({
      ...input,
      auditWriter: resolveAuditWriter(),
      hooks: options.hooks,
      transaction: await ensureTransaction(),
    } as ExecuteAuthMutationOptions<E, TResult>);

  const transaction = <T>(
    fn: (scope: AthenaAuthMutationScope) => Promise<T>
  ): Promise<T> => ensureTransaction().then((run) => run(fn));

  const listOrganizationLifecycleAuditRows = async (input: {
    after?: { createdAt: string; eventId: string };
    limit: number;
    organizationId: string;
  }): Promise<{ hasMore: boolean; rows: Record<string, unknown>[] }> => {
    if (!observability.auditLog) {
      throw AthenaAuthRuntimeError.capabilityDisabled("Auth audit logging");
    }
    const limit = Math.max(1, Math.min(100, Math.trunc(input.limit)));
    const events = [
      "authorization.member.roles.replace",
      "organization.member.add",
      "organization.member.remove",
      "organization.member.role.update",
    ];
    if (database) {
      const result = await database.query<{
        created_at: string;
        event: string;
        event_id: string;
        organization_id: string;
        previous: unknown;
        result: unknown;
        subject_id: string;
        subject_type: string;
      }>(
        `SELECT event_id, event, subject_type, subject_id, organization_id, previous, result, created_at::text AS created_at
           FROM athena.audit_log_auth
          WHERE organization_id = $1
            AND event = ANY($2::text[])
            AND outcome = 'success'
            AND ($3::timestamptz IS NULL OR (created_at, event_id) < ($3::timestamptz, $4::uuid))
          ORDER BY created_at DESC, event_id DESC
          LIMIT $5`,
        [
          input.organizationId,
          events,
          input.after?.createdAt ?? null,
          input.after?.eventId ?? null,
          limit + 1,
        ]
      );
      return {
        hasMore: result.rows.length > limit,
        rows: result.rows.slice(0, limit) as Record<string, unknown>[],
      };
    }

    const rows = auditSink.entries
      .filter(
        (entry) =>
          entry.organizationId === input.organizationId &&
          entry.outcome === "success" &&
          events.includes(entry.event) &&
          (entry.subject?.type === "organization.member" ||
            entry.subject?.type === "authorization.role")
      )
      .map((entry) => ({
        created_at:
          auditSink.createdAt?.get(entry.eventId)?.toISOString() ??
          new Date(0).toISOString(),
        event: entry.event,
        event_id: entry.eventId,
        organization_id: entry.organizationId,
        previous: entry.previous,
        result: entry.result,
        subject_id: entry.subject?.id,
        subject_type: entry.subject?.type,
      }))
      .filter((row) => {
        if (!input.after) {
          return true;
        }
        const at = new Date(row.created_at).getTime();
        const cursorAt = new Date(input.after.createdAt).getTime();
        return (
          at < cursorAt ||
          (at === cursorAt && row.event_id < input.after.eventId)
        );
      })
      .sort((left, right) => {
        const byDate =
          new Date(right.created_at).getTime() -
          new Date(left.created_at).getTime();
        return byDate || right.event_id.localeCompare(left.event_id);
      });
    return { hasMore: rows.length > limit, rows: rows.slice(0, limit) };
  };

  const resolveSession = async (
    request: Request,
    currentStores: AthenaAuthStores
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
          config.session.cookieName
        );
      if (!token) {
        return null;
      }
      const session = await currentStores.getSessionByToken(token);
      if (!session) {
        return null;
      }
      const user = await timeAuthSpan("user_lookup", () =>
        currentStores.getUserById(session.user_id)
      );
      if (!user) {
        return null;
      }
      if (user.banned && !isUserEffectivelyBanned(user)) {
        await currentStores.updateUser(user.id, {
          banExpires: null,
          banned: false,
          banReason: null,
        });
        user.banned = false;
        user.ban_expires = null;
        user.ban_reason = null;
      } else if (isUserEffectivelyBanned(user)) {
        return null;
      }
      // AUTH-ORG-CTX-001: drop a stale activeOrganizationId on every resolve.
      const sessionWithOrg = await normalizeSessionActiveOrganization(
        session,
        currentStores
      );
      if (
        !config.session.disableSessionRefresh &&
        Date.now() - new Date(sessionWithOrg.updated_at).getTime() >=
          config.session.updateAgeSeconds * 1000
      ) {
        await timeAuthSpan("session_refresh", async () => {
          const expiresAt = new Date(
            Date.now() + config.session.expiresInSeconds * 1000
          );
          await currentStores.updateSessionExpiry(token, expiresAt);
          sessionWithOrg.expires_at = expiresAt;
          sessionWithOrg.updated_at = new Date();
        });
      }
      return { session: sessionWithOrg, token, user };
    });

  const requireSession = async (
    request: Request,
    currentStores: AthenaAuthStores
  ) => {
    const resolved = await resolveSession(request, currentStores);
    if (!resolved) {
      if (
        readBearerToken(request.headers.get("authorization")) ||
        readSessionTokenFromCookies(
          request.headers.get("cookie"),
          config.session.cookieName
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
    authentication: IssueSessionAuthentication
  ) => {
    const expiresAt = new Date(
      Date.now() + config.session.expiresInSeconds * 1000
    );
    const session = await currentStores.createSession({
      authenticatedAt: authentication.authenticatedAt,
      authenticationMethods: authentication.methods,
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
      })
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
            "Database-backed Auth runtime requires a Postgres bridge code store"
          )
        );
      }
      postgresBridgeCodeStore = createPostgresAuthBridgeCodeStore(db);
    }
    return postgresBridgeCodeStore;
  };

  let socialRuntime: AthenaEmbeddedSocialRuntime | null | undefined;
  const getSocialRuntime =
    async (): Promise<AthenaEmbeddedSocialRuntime | null> => {
      if (socialRuntime !== undefined) {
        return socialRuntime;
      }
      await ensureReady();
      socialRuntime = composeEmbeddedSocialRuntime({
        allowEmptyProviders: true,
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

  const getOAuthStores = async (): Promise<OAuthAuthorizationServerStores> => {
    if (oauthStores) {
      return oauthStores;
    }
    if (memoryStores && !hasExternalDatabase && !connectionString) {
      const memoryOAuth = createMemoryOAuthAuthorizationServerStores({
        state: oauthMemoryState,
      });
      oauthStores = memoryOAuth;
      return memoryOAuth;
    }
    await ensureReady();
    if (!database) {
      throw AthenaAuthRuntimeError.internal(
        new Error("OAuth authorization-server persistence requires PostgreSQL")
      );
    }
    const postgresOAuth =
      createPostgresOAuthAuthorizationServerStores(database);
    oauthStores = postgresOAuth;
    return postgresOAuth;
  };

  const getTokenKeyStore = async (issuer?: string): Promise<TokenKeyStore> => {
    const identity = requireProtocolIdentity();
    if (issuer && issuer !== identity.issuer) {
      throw AthenaAuthRuntimeError.internal(
        new Error("Token key store issuer must match Athena protocol identity")
      );
    }
    if (tokenKeyStore) {
      return tokenKeyStore;
    }
    if (memoryStores && !hasExternalDatabase && !connectionString) {
      if (protocolEnvironment === "production") {
        rejectProductionEphemeralTokenKeys();
      }
      tokenKeyStore ??= getOrCreateProcessTokenKeyStore(identity.issuer);
      return tokenKeyStore;
    }
    await ensureReady();
    if (!database) {
      throw AthenaAuthRuntimeError.internal(
        new Error("JWT signing persistence requires PostgreSQL")
      );
    }
    runtimeKeyMaterial ??= (
      await resolveRuntimeKey(database, options.secret ?? config.secret)
    ).material;
    tokenKeyStore = new PostgresTokenKeyStore({
      database,
      encryptionSecret: runtimeKeyMaterial,
      issuer: identity.issuer,
    });
    return tokenKeyStore;
  };

  const resolveStateSecret = async (): Promise<string> => {
    if (options.secret) {
      return options.secret;
    }
    if (config.secret) {
      return config.secret;
    }
    if (memoryStores && !hasExternalDatabase && !connectionString) {
      ephemeralStateSecret ??= generateOpaqueSecret();
      return ephemeralStateSecret;
    }
    await ensureReady();
    if (!runtimeKeyMaterial && database) {
      runtimeKeyMaterial = (
        await resolveRuntimeKey(database, options.secret ?? config.secret)
      ).material;
    }
    if (!runtimeKeyMaterial) {
      throw AthenaAuthRuntimeError.internal(
        new Error(
          "OAuth state encryption requires configured secret or runtime key"
        )
      );
    }
    return runtimeKeyMaterial;
  };

  const getProtocolRuntime = async (): Promise<AuthProtocolRuntime> => {
    if (protocolRuntime) {
      return protocolRuntime;
    }
    await ensureReady();
    const identity = requireProtocolIdentity();
    const keyStore = await getTokenKeyStore(identity.issuer);
    const signing = new AthenaTokenAuthority({ clock, identity, keyStore });
    const stateSecret = await resolveStateSecret();
    const stores = await getOAuthStores();
    const oauth = new OAuthAuthorizationServerService({
      clock,
      config: config.authorizationServer,
      getUser: async (userId) => {
        const user = await (await ensureReady()).getUserById(userId);
        return user ?? null;
      },
      issuer: identity.issuer,
      userInfoEndpoint: identity.userInfoEndpoint,
      keyStore,
      signing,
      stateSecret,
      stores,
      userIsEligible: async ({ organizationId, userId }, authStores) => {
        const readyStores = authStores ?? (await ensureReady());
        const user = await readyStores.getUserById(userId);
        if (!user || isUserEffectivelyBanned(user)) {
          return false;
        }
        return organizationId
          ? Boolean(await readyStores.getMember(organizationId, userId))
          : true;
      },
    });
    const legacyToken = await createLocalTokenAuthority({
      audiences: ["athena", "neon"],
      signing,
      tokenEndpoint: joinAuthProtocolUrl(identity.publicBaseUrl, "/token"),
    });
    tokenAuthority = legacyToken;
    const runtime: AuthProtocolRuntime = {
      clock,
      forMutation: (scope) => rebindProtocolRuntime(runtime, scope),
      identity,
      legacyToken,
      oauth,
      signing,
      stateSecret,
    };
    protocolRuntime = runtime;
    return runtime;
  };

  const getOAuthRuntimeJwtVerifier = async (
    resource: string
  ): Promise<AthenaRuntimeJwtVerifier> => {
    const protocol = await getProtocolRuntime();
    if (!config.authorizationServer.enabled) {
      throw AthenaAuthRuntimeError.internal(
        new Error("OAuth authorization server is not configured")
      );
    }
    const oauthStores = await getOAuthStores();
    return createOAuthRuntimeJwtVerifier({
      clock,
      issuer: protocol.identity.issuer,
      keyStore: await getTokenKeyStore(protocol.identity.issuer),
      resolvePrincipal: async ({ claims, organizationId, scopes, userId }) => {
        const authStores = await ensureReady();
        const user = await authStores.getUserById(userId);
        if (!user || isUserEffectivelyBanned(user)) {
          return null;
        }
        if (
          organizationId &&
          !(await authStores.getMember(organizationId, userId))
        ) {
          return null;
        }
        const rights = await authStores.resolveEffectiveRights({
          activeOrganizationId: organizationId,
          userId,
        });
        return {
          authenticated: true,
          grants: [],
          ...(organizationId ? { organizationId } : {}),
          oauth: {
            clientId: claims.client_id,
            grantId: claims.athena_grant_id,
            ...(claims.athena_identity_scopes
              ? { identityScopes: claims.athena_identity_scopes }
              : {}),
            resource,
            scopes,
          },
          rights: rights.flatMap((right) => {
            const parsed = tryParseAthenaRightKey(right);
            return parsed ? [parsed] : [];
          }),
          userId,
        };
      },
      resource,
      signing: protocol.signing,
      stores: oauthStores,
    });
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
    authorizationAssignmentsSupported,
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
    getOAuthRuntimeJwtVerifier,
    getOAuthStores,
    getProtocolRuntime,
    getSocialRuntime,
    resolveIdentityConnectionCredential:
      options.resolveIdentityConnectionCredential,
    getTokenAuthority: () => tokenAuthority,
    getTokenKeyStore,
    hasher,
    hookRequest,
    hooksRef: options.hooks,
    identityOf,
    issueSession,
    listOrganizationLifecycleAuditRows,
    migrate: async () => {
      if (stores instanceof SqliteAuthStores) {
        if (database) {
          await applyAthenaAuthSqliteSchema(database);
        }
        return;
      }
      if (!database) {
        if (!connectionString) {
          return;
        }
        database = await createPostgresAuthDatabase(connectionString);
      }
      await migrateAthenaAuthSchema(database);
    },
    mutate,
    oauthRateLimiter,
    observability,
    otpRateLimiter,
    otpVerificationRateLimiter,
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
    transaction,
  };
}
