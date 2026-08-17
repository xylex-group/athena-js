import type { AthenaSessionData } from "../auth/session-data.ts";
import { toSessionData } from "../auth/session-data.ts";
import {
  isAbortError,
  toAthenaSessionError,
} from "../auth/session-errors.ts";
import type {
  AthenaAuthErrorDetails,
  AthenaAuthResult,
  AthenaAuthSessionResponse,
} from "../auth/types.ts";
import { type OrganizationLike } from "../organization/ensure-active-organization.ts";
import {
  ATHENA_SESSION_DATA_HEADER,
  createFreshSessionLookupUrl,
} from "../utils/athena-auth-url.ts";
import {
  type AthenaRequestCookiesInput,
  type AthenaRequestHeadersInput,
  type AthenaServerRequestOptions,
  resolveNextRequestContext,
} from "./shared.ts";

/** Stable machine codes carried on result.error.hint for throw mapping. */
export const SESSION_ERROR_HINT = {
  configuration: "ATHENA_SESSION_CONFIGURATION",
  noOrganization: "ATHENA_SESSION_NO_ACCESSIBLE_ORGANIZATION",
  protocol: "ATHENA_SESSION_PROTOCOL",
  upstream: "ATHENA_SESSION_UPSTREAM",
} as const;

export interface ResolveActiveOrganizationIdArgs {
  rawActiveOrganizationId: string | null;
  session: AthenaAuthSessionResponse;
  userId: string;
}

export interface GetServerSessionEnsureActiveOptions<
  TOrganization extends OrganizationLike = OrganizationLike,
> {
  listOrganizations: () => Promise<readonly TOrganization[]>;
  onError?: (error: unknown) => void;
  selectOrganizationId?: (
    organizations: readonly TOrganization[]
  ) => string | null;
  setActiveOrganization: (organizationId: string) => Promise<unknown>;
  persist?: boolean;
  onEmpty?: "allow-null" | "error";
}

export type EnsureActiveStrategy =
  | "first-accessible"
  | ((args: {
      organizations: readonly OrganizationLike[];
    }) => string | null);

export interface EnsureActiveConfig {
  onEmpty?: "allow-null" | "error";
  persist: boolean;
  strategy?: EnsureActiveStrategy;
}

export interface GetServerSessionOptions extends AthenaServerRequestOptions {
  appOrigin?: string | URL;
  authSessionUrl?: string | URL;
  client?: ServerSessionClientLike | null;
  ensureActiveOrganization?: GetServerSessionEnsureActiveOptions;
  fetchImpl?: typeof fetch;
  organization?: {
    ensureActive?: EnsureActiveConfig | true;
  };
  resolveActiveOrganizationId?: (
    args: ResolveActiveOrganizationIdArgs
  ) => string | null | Promise<string | null>;
  sessionDataHeader?: string | null;
  skipFetchWithoutCredentials?: boolean;
}

export interface OrganizationResolution {
  activeId: string | null;
  attempted: boolean;
  changed: boolean;
  persisted: boolean;
  previousId: string | null;
  repaired: boolean;
  upstreamCalls: number;
}

export interface ServerSessionMeta {
  fromSessionDataHeader: boolean;
  organizationResolution?: OrganizationResolution;
  requestId?: string;
}

export type GetServerSessionResult =
  | {
      ok: true;
      authenticated: true;
      data: AthenaSessionData;
      error: null;
      meta: ServerSessionMeta;
    }
  | {
      ok: true;
      authenticated: false;
      data: null;
      error: null;
      meta: ServerSessionMeta;
    }
  | {
      ok: false;
      authenticated: false;
      data: null;
      error: AthenaAuthErrorDetails;
      meta: ServerSessionMeta;
    };

export interface ServerSessionClientLike {
  auth?: {
    organization?: {
      list?: (
        ...args: never[]
      ) => Promise<
        | AthenaAuthResult<OrganizationLike[] | null>
        | {
            ok: boolean;
            data?: OrganizationLike[] | null;
            error?: string | null;
            errorDetails?: AthenaAuthErrorDetails | null;
            status?: number;
          }
      >;
      setActive?: (input: {
        organizationId: string;
      }) => Promise<
        | AthenaAuthResult<unknown>
        | {
            ok: boolean;
            data?: unknown;
            error?: string | null;
            errorDetails?: AthenaAuthErrorDetails | null;
            status?: number;
          }
      >;
    };
  };
}

function normalizeId(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readHeader(
  headers: AthenaRequestHeadersInput | undefined,
  target: string
): string | undefined {
  if (!headers) {
    return undefined;
  }
  if (
    typeof (headers as { get?: (name: string) => string | null }).get ===
    "function"
  ) {
    const value = (headers as { get: (name: string) => string | null }).get(
      target
    );
    return value?.trim() || undefined;
  }
  const normalizedTarget = target.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === normalizedTarget) {
      const normalized = value?.trim();
      return normalized || undefined;
    }
  }
  return undefined;
}

function sessionError(
  hint: (typeof SESSION_ERROR_HINT)[keyof typeof SESSION_ERROR_HINT],
  message: string,
  extra: Partial<AthenaAuthErrorDetails> = {}
): AthenaAuthErrorDetails {
  return {
    cause: extra.cause,
    code: extra.code ?? "UNKNOWN_ERROR",
    endpoint: extra.endpoint,
    hint,
    message,
    method: extra.method,
    requestId: extra.requestId,
    status: extra.status ?? 0,
  };
}

export type ParseSessionDataHeaderResult =
  | { status: "missing" }
  | { status: "invalid"; error: AthenaAuthErrorDetails }
  | { status: "ok"; session: AthenaAuthSessionResponse };

export function parseAthenaSessionDataHeaderResult(
  raw: string | null | undefined
): ParseSessionDataHeaderResult {
  if (raw == null || !String(raw).trim()) {
    return { status: "missing" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(raw)) as unknown;
  } catch (cause) {
    return {
      status: "invalid",
      error: sessionError(
        SESSION_ERROR_HINT.protocol,
        "Malformed x-session-data header JSON",
        {
          cause: cause instanceof Error ? cause.message : String(cause),
          code: "INVALID_JSON",
          status: 400,
        }
      ),
    };
  }
  const session = coerceSessionResponse(parsed);
  if (!session) {
    return {
      status: "invalid",
      error: sessionError(
        SESSION_ERROR_HINT.protocol,
        "Malformed x-session-data header payload",
        {
          code: "INVALID_JSON",
          status: 400,
        }
      ),
    };
  }
  return { status: "ok", session };
}

export function parseAthenaSessionDataHeader(
  raw: string | null | undefined
): AthenaAuthSessionResponse | null {
  const result = parseAthenaSessionDataHeaderResult(raw);
  return result.status === "ok" ? result.session : null;
}

function coerceSessionResponse(
  value: unknown
): AthenaAuthSessionResponse | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;

  const payload =
    record.session && record.user
      ? record
      : record.data && typeof record.data === "object"
        ? (record.data as Record<string, unknown>)
        : null;

  if (!payload) {
    return null;
  }
  const user = payload.user;
  const session = payload.session;
  if (
    !user ||
    typeof user !== "object" ||
    !session ||
    typeof session !== "object"
  ) {
    return null;
  }
  const userRecord = user as Record<string, unknown>;
  const sessionRecord = session as Record<string, unknown>;
  const userId = normalizeId(
    typeof userRecord.id === "string" ? userRecord.id : undefined
  );
  const sessionId = normalizeId(
    typeof sessionRecord.id === "string" ? sessionRecord.id : undefined
  );
  if (!(userId && sessionId)) {
    return null;
  }

  return {
    session: {
      activeOrganizationId: normalizeId(
        typeof sessionRecord.activeOrganizationId === "string"
          ? sessionRecord.activeOrganizationId
          : null
      ),
      expiresAt:
        typeof sessionRecord.expiresAt === "string"
          ? sessionRecord.expiresAt
          : undefined,
      id: sessionId,
      token:
        typeof sessionRecord.token === "string"
          ? sessionRecord.token
          : undefined,
      userId:
        typeof sessionRecord.userId === "string"
          ? sessionRecord.userId
          : userId,
    },
    user: {
      email: typeof userRecord.email === "string" ? userRecord.email : "",
      emailVerified:
        typeof userRecord.emailVerified === "boolean"
          ? userRecord.emailVerified
          : undefined,
      id: userId,
      image: typeof userRecord.image === "string" ? userRecord.image : null,
      name: typeof userRecord.name === "string" ? userRecord.name : null,
      role: typeof userRecord.role === "string" ? userRecord.role : null,
      username:
        typeof userRecord.username === "string" ? userRecord.username : null,
    },
  };
}

export type FetchSessionOutcome =
  | { kind: "ok"; session: AthenaAuthSessionResponse | null }
  | { kind: "error"; error: AthenaAuthErrorDetails };

export function classifyGetSessionPayload(
  json: unknown,
  httpStatus: number
): FetchSessionOutcome {
  if (json == null || json === "") {
    return { kind: "ok", session: null };
  }
  if (typeof json !== "object") {
    return {
      kind: "error",
      error: sessionError(
        SESSION_ERROR_HINT.protocol,
        "get-session returned non-object JSON",
        { code: "INVALID_JSON", status: httpStatus }
      ),
    };
  }

  const record = json as Record<string, unknown>;
  if (Object.keys(record).length === 0) {
    return { kind: "ok", session: null };
  }

  const hasEnvelope =
    "session" in record || "user" in record || "data" in record;

  if (!hasEnvelope) {
    return {
      kind: "error",
      error: sessionError(
        SESSION_ERROR_HINT.protocol,
        "get-session payload missing session/user",
        { code: "INVALID_JSON", status: httpStatus }
      ),
    };
  }

  if ("data" in record && record.data == null && !("session" in record)) {
    return { kind: "ok", session: null };
  }
  if (
    "session" in record &&
    record.session == null &&
    (record.user == null || record.user === undefined)
  ) {
    return { kind: "ok", session: null };
  }

  const session = coerceSessionResponse(json);
  if (session) {
    return { kind: "ok", session };
  }

  return {
    kind: "error",
    error: sessionError(
      SESSION_ERROR_HINT.protocol,
      "get-session payload malformed session/user",
      { code: "INVALID_JSON", status: httpStatus }
    ),
  };
}

async function fetchSessionFromAuth(options: {
  url: string;
  cookie?: string | null;
  bearerToken?: string | null;
  fetchImpl: typeof fetch;
}): Promise<FetchSessionOutcome> {
  const headers: Record<string, string> = {
    accept: "application/json",
  };
  if (options.cookie) {
    headers.cookie = options.cookie;
  }
  if (options.bearerToken) {
    headers.authorization = `Bearer ${options.bearerToken}`;
  }

  try {
    const response = await options.fetchImpl(options.url, {
      cache: "no-store",
      headers,
      method: "GET",
    });
    if (response.status === 401) {
      return { kind: "ok", session: null };
    }
    if (!response.ok) {
      return {
        kind: "error",
        error: sessionError(
          SESSION_ERROR_HINT.upstream,
          `get-session failed with HTTP ${response.status}`,
          {
            code: "HTTP_ERROR",
            status: response.status,
          }
        ),
      };
    }
    let json: unknown;
    try {
      json = await response.json();
    } catch (cause) {
      return {
        kind: "error",
        error: sessionError(
          SESSION_ERROR_HINT.protocol,
          "get-session returned invalid JSON",
          {
            cause: cause instanceof Error ? cause.message : String(cause),
            code: "INVALID_JSON",
            status: response.status,
          }
        ),
      };
    }
    return classifyGetSessionPayload(json, response.status);
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    return {
      kind: "error",
      error: sessionError(
        SESSION_ERROR_HINT.upstream,
        error instanceof Error ? error.message : "get-session network failure",
        {
          cause: error instanceof Error ? error.message : String(error),
          code: "NETWORK_ERROR",
          status: 0,
        }
      ),
    };
  }
}

function resolveSessionLookupUrl(
  options: GetServerSessionOptions
): string | null {
  if (options.authSessionUrl) {
    return String(options.authSessionUrl);
  }
  if (options.appOrigin) {
    return createFreshSessionLookupUrl(options.appOrigin).toString();
  }
  return null;
}

function resolveEnsureActiveConfig(
  options: GetServerSessionOptions
): EnsureActiveConfig | null {
  if (options.organization?.ensureActive === true) {
    return {
      persist: true,
      strategy: "first-accessible",
      onEmpty: "allow-null",
    };
  }
  if (
    options.organization?.ensureActive &&
    typeof options.organization.ensureActive === "object"
  ) {
    return {
      onEmpty: options.organization.ensureActive.onEmpty ?? "allow-null",
      persist: options.organization.ensureActive.persist,
      strategy:
        options.organization.ensureActive.strategy ?? "first-accessible",
    };
  }
  if (options.ensureActiveOrganization) {
    return {
      onEmpty: options.ensureActiveOrganization.onEmpty ?? "allow-null",
      persist: options.ensureActiveOrganization.persist !== false,
      strategy: options.ensureActiveOrganization.selectOrganizationId
        ? ({ organizations }) =>
            options.ensureActiveOrganization?.selectOrganizationId?.(
              organizations
            ) ?? null
        : "first-accessible",
    };
  }
  return null;
}

class OrganizationBindingError extends Error {
  readonly details: AthenaAuthErrorDetails | null;
  readonly status: number;

  constructor(
    message: string,
    details: AthenaAuthErrorDetails | null,
    status: number
  ) {
    super(message);
    this.name = "OrganizationBindingError";
    this.details = details;
    this.status = status;
  }
}

function buildInjectableEnsure(
  options: GetServerSessionOptions,
  config: EnsureActiveConfig
): GetServerSessionEnsureActiveOptions | null {
  if (options.ensureActiveOrganization) {
    return {
      ...options.ensureActiveOrganization,
      onEmpty: config.onEmpty,
      persist: config.persist,
      selectOrganizationId:
        typeof config.strategy === "function"
          ? (orgs) =>
              (
                config.strategy as (args: {
                  organizations: readonly OrganizationLike[];
                }) => string | null
              )({ organizations: orgs })
          : options.ensureActiveOrganization.selectOrganizationId,
    };
  }

  const org = options.client?.auth?.organization;
  if (!(org?.list && org.setActive)) {
    return null;
  }

  const select =
    typeof config.strategy === "function"
      ? (organizations: readonly OrganizationLike[]) =>
          (
            config.strategy as (args: {
              organizations: readonly OrganizationLike[];
            }) => string | null
          )({ organizations })
      : (organizations: readonly OrganizationLike[]) =>
          organizations[0]?.id ?? null;

  return {
    listOrganizations: async () => {
      const result = await org.list!();
      if (!(result.ok && Array.isArray(result.data))) {
        const details =
          "errorDetails" in result ? (result.errorDetails ?? null) : null;
        const message =
          details?.message ??
          ("error" in result && typeof result.error === "string"
            ? result.error
            : null) ??
          "organization.list failed";
        throw new OrganizationBindingError(
          message,
          details,
          ("status" in result && typeof result.status === "number"
            ? result.status
            : details?.status) ?? 0
        );
      }
      return result.data;
    },
    onEmpty: config.onEmpty,
    persist: config.persist,
    selectOrganizationId: select,
    setActiveOrganization: async (organizationId: string) => {
      const result = await org.setActive!({ organizationId });
      if (!result.ok) {
        const details =
          "errorDetails" in result ? (result.errorDetails ?? null) : null;
        const message =
          details?.message ??
          ("error" in result && typeof result.error === "string"
            ? result.error
            : null) ??
          "organization.setActive failed";
        throw new OrganizationBindingError(
          message,
          details,
          ("status" in result && typeof result.status === "number"
            ? result.status
            : details?.status) ?? 0
        );
      }
    },
  };
}

export function throwFromServerSessionResult(
  error: AthenaAuthErrorDetails
): never {
  const hint = error.hint;
  const message = error.message ?? "Session resolution failed";

  if (
    hint === SESSION_ERROR_HINT.noOrganization ||
    hint === "ATHENA_SESSION_NO_ACCESSIBLE_ORGANIZATION"
  ) {
    throw toAthenaSessionError("no_organization", {
      details: error,
      message,
    });
  }
  if (hint === SESSION_ERROR_HINT.protocol || error.code === "INVALID_JSON") {
    throw toAthenaSessionError("protocol", {
      details: error,
      message,
    });
  }
  if (hint === SESSION_ERROR_HINT.configuration) {
    throw toAthenaSessionError("configuration", {
      details: error,
      message,
    });
  }
  throw toAthenaSessionError("upstream", {
    details: error,
    message,
  });
}

export function mapGetServerSessionOrNull(
  result: GetServerSessionResult
): AthenaSessionData | null {
  if (!result.ok) {
    throwFromServerSessionResult(result.error);
  }
  if (!result.authenticated) {
    return null;
  }
  return result.data;
}

export function mapRequireServerSession(
  result: GetServerSessionResult,
  options: { onUnauthenticated?: () => never | void } = {}
): AthenaSessionData {
  if (!result.ok) {
    throwFromServerSessionResult(result.error);
  }
  if (!result.authenticated || !result.data) {
    if (options.onUnauthenticated) {
      options.onUnauthenticated();
    }
    throw toAthenaSessionError("unauthenticated", {
      message: "Not authenticated",
    });
  }
  return result.data;
}

/**
 * Load the current Athena Auth session for Next.js RSC / route handlers.
 *
 * Upstream call budget (hard max 3 network ops):
 * - 0..1 session fetch
 * - 0..1 organization list
 * - 0..1 setActive
 */
export async function getServerSession(
  options: GetServerSessionOptions = {}
): Promise<GetServerSessionResult> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const skipWithoutCredentials = options.skipFetchWithoutCredentials !== false;
  let upstreamCalls = 0;
  const MAX_UPSTREAM_CALLS = 3;

  const hasExplicitRequestInputs =
    options.requestHeaders !== undefined ||
    options.requestCookies !== undefined ||
    options.sessionDataHeader !== undefined;

  const requestHeaders =
    options.requestHeaders ?? (hasExplicitRequestInputs ? {} : undefined);
  const requestCookies =
    options.requestCookies ?? (hasExplicitRequestInputs ? "" : undefined);

  const request = await resolveNextRequestContext({
    forceNoCache: options.forceNoCache,
    headers: options.headers,
    requestCookies,
    requestHeaders,
  });

  const headerRaw =
    options.sessionDataHeader === undefined
      ? (readHeader(requestHeaders, ATHENA_SESSION_DATA_HEADER) ??
        readHeader(requestHeaders, "x-session-data"))
      : options.sessionDataHeader;

  let fromSessionDataHeader = false;
  let transport: AthenaAuthSessionResponse | null = null;

  const headerParsed = parseAthenaSessionDataHeaderResult(headerRaw);
  if (headerParsed.status === "ok") {
    transport = headerParsed.session;
    fromSessionDataHeader = true;
  } else if (headerParsed.status === "invalid") {
    return {
      ok: false,
      authenticated: false,
      data: null,
      error: headerParsed.error,
      meta: { fromSessionDataHeader: false },
    };
  } else {
    const hasCredentials = Boolean(request.cookie || request.bearerToken);
    if (!skipWithoutCredentials || hasCredentials) {
      const lookupUrl = resolveSessionLookupUrl(options);
      if (!lookupUrl) {
        if (hasCredentials) {
          return {
            ok: false,
            authenticated: false,
            data: null,
            error: sessionError(
              SESSION_ERROR_HINT.configuration,
              "getServerSession requires appOrigin or authSessionUrl when credentials are present"
            ),
            meta: { fromSessionDataHeader: false },
          };
        }
      } else {
        upstreamCalls += 1;
        const fetched = await fetchSessionFromAuth({
          bearerToken: request.bearerToken,
          cookie: request.cookie,
          fetchImpl,
          url: lookupUrl,
        });
        if (fetched.kind === "error") {
          return {
            ok: false,
            authenticated: false,
            data: null,
            error: fetched.error,
            meta: {
              fromSessionDataHeader: false,
              requestId: fetched.error.requestId,
            },
          };
        }
        transport = fetched.session;
      }
    }
  }

  if (!transport) {
    return {
      ok: true,
      authenticated: false,
      data: null,
      error: null,
      meta: { fromSessionDataHeader: false },
    };
  }

  const userId = normalizeId(transport.user?.id);
  const rawActiveOrganizationId = normalizeId(
    transport.session?.activeOrganizationId
  );

  let organizationId = rawActiveOrganizationId;
  if (userId && options.resolveActiveOrganizationId) {
    organizationId = normalizeId(
      await options.resolveActiveOrganizationId({
        rawActiveOrganizationId,
        session: transport,
        userId,
      })
    );
  }

  let organizationResolution: OrganizationResolution | undefined;
  const ensureConfig = resolveEnsureActiveConfig(options);

  if (ensureConfig && userId && !organizationId) {
    const injectable = buildInjectableEnsure(options, ensureConfig);
    if (!injectable && options.organization?.ensureActive) {
      return {
        ok: false,
        authenticated: false,
        data: null,
        error: sessionError(
          SESSION_ERROR_HINT.configuration,
          "organization.ensureActive requires client.auth.organization.list/setActive or ensureActiveOrganization injectables"
        ),
        meta: { fromSessionDataHeader },
      };
    }

    if (injectable) {
      let listCalls = 0;
      let setCalls = 0;

      const listOrganizations = async () => {
        listCalls += 1;
        if (listCalls > 1) {
          throw new Error("organization list budget exceeded");
        }
        upstreamCalls += 1;
        return injectable.listOrganizations();
      };

      const setActiveOrganization = async (id: string) => {
        if (!ensureConfig.persist) {
          return undefined;
        }
        setCalls += 1;
        if (setCalls > 1) {
          throw new Error("organization setActive budget exceeded");
        }
        upstreamCalls += 1;
        await injectable.setActiveOrganization(id);
      };

      let orgs: readonly OrganizationLike[] = [];
      try {
        orgs = await listOrganizations();
      } catch (error) {
        injectable.onError?.(error);
        if (error instanceof OrganizationBindingError) {
          return {
            ok: false,
            authenticated: false,
            data: null,
            error:
              error.details ??
              sessionError(SESSION_ERROR_HINT.upstream, error.message, {
                code: "HTTP_ERROR",
                status: error.status,
              }),
            meta: { fromSessionDataHeader },
          };
        }
        return {
          ok: false,
          authenticated: false,
          data: null,
          error: sessionError(
            SESSION_ERROR_HINT.upstream,
            "Failed to list organizations for ensureActive",
            {
              cause: error instanceof Error ? error.message : String(error),
              code: "HTTP_ERROR",
              status: 0,
            }
          ),
          meta: { fromSessionDataHeader },
        };
      }

      if (orgs.length === 0) {
        if (ensureConfig.onEmpty === "error") {
          return {
            ok: false,
            authenticated: false,
            data: null,
            error: sessionError(
              SESSION_ERROR_HINT.noOrganization,
              "No accessible organization"
            ),
            meta: {
              fromSessionDataHeader,
              organizationResolution: {
                activeId: null,
                attempted: true,
                changed: false,
                persisted: false,
                previousId: null,
                repaired: false,
                upstreamCalls,
              },
            },
          };
        }
        organizationResolution = {
          activeId: null,
          attempted: true,
          changed: false,
          persisted: false,
          previousId: null,
          repaired: false,
          upstreamCalls,
        };
      } else {
        const select =
          typeof ensureConfig.strategy === "function"
            ? ensureConfig.strategy
            : ({
                organizations,
              }: {
                organizations: readonly OrganizationLike[];
              }) => organizations[0]?.id ?? null;
        const selected = normalizeId(select({ organizations: orgs }));

        if (!selected) {
          if (ensureConfig.onEmpty === "error") {
            return {
              ok: false,
              authenticated: false,
              data: null,
              error: sessionError(
                SESSION_ERROR_HINT.noOrganization,
                "No accessible organization"
              ),
              meta: { fromSessionDataHeader },
            };
          }
          organizationResolution = {
            activeId: null,
            attempted: true,
            changed: false,
            persisted: false,
            previousId: null,
            repaired: false,
            upstreamCalls,
          };
        } else {
          let persisted = false;
          if (ensureConfig.persist) {
            try {
              await setActiveOrganization(selected);
              persisted = true;
            } catch (error) {
              injectable.onError?.(error);
              if (error instanceof OrganizationBindingError) {
                return {
                  ok: false,
                  authenticated: false,
                  data: null,
                  error:
                    error.details ??
                    sessionError(SESSION_ERROR_HINT.upstream, error.message, {
                      code: "HTTP_ERROR",
                      status: error.status,
                    }),
                  meta: { fromSessionDataHeader },
                };
              }
              return {
                ok: false,
                authenticated: false,
                data: null,
                error: sessionError(
                  SESSION_ERROR_HINT.upstream,
                  "Failed to setActive organization",
                  {
                    cause:
                      error instanceof Error ? error.message : String(error),
                    code: "HTTP_ERROR",
                    status: 0,
                  }
                ),
                meta: { fromSessionDataHeader },
              };
            }
          }
          organizationId = selected;
          organizationResolution = {
            activeId: selected,
            attempted: true,
            changed: true,
            persisted,
            previousId: null,
            repaired: true,
            upstreamCalls,
          };
        }
      }
    }
  } else if (ensureConfig && organizationId) {
    organizationResolution = {
      activeId: organizationId,
      attempted: false,
      changed: false,
      persisted: false,
      previousId: organizationId,
      repaired: false,
      upstreamCalls,
    };
  }

  if (organizationResolution) {
    organizationResolution = {
      ...organizationResolution,
      upstreamCalls,
    };
  }

  if (upstreamCalls > MAX_UPSTREAM_CALLS) {
    return {
      ok: false,
      authenticated: false,
      data: null,
      error: sessionError(
        SESSION_ERROR_HINT.configuration,
        `session resolution exceeded upstream call budget (${upstreamCalls} > ${MAX_UPSTREAM_CALLS})`
      ),
      meta: { fromSessionDataHeader, organizationResolution },
    };
  }

  const data = toSessionData(transport, {
    activeId: organizationId,
    rawActiveId: rawActiveOrganizationId,
  });

  return {
    ok: true,
    authenticated: true,
    data,
    error: null,
    meta: {
      fromSessionDataHeader,
      organizationResolution,
    },
  };
}

export async function getServerSessionOrNull(
  options: GetServerSessionOptions = {}
): Promise<AthenaSessionData | null> {
  return mapGetServerSessionOrNull(await getServerSession(options));
}

export interface RequireServerSessionOptions extends GetServerSessionOptions {
  onUnauthenticated?: () => never | void;
}

export async function requireServerSession(
  options: RequireServerSessionOptions = {}
): Promise<AthenaSessionData> {
  return mapRequireServerSession(await getServerSession(options), options);
}

export type { AthenaRequestCookiesInput, AthenaRequestHeadersInput };