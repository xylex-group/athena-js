import {
  createAthenaAuthCapabilitiesStore,
  isCapabilityEnabled,
  isSocialCapabilityEnabled,
} from "./capabilities.ts";
import { createAthenaAuthSessionController } from "./session-controller.ts";
import {
  UPSTREAM_UNAVAILABLE_CODE,
  UPSTREAM_UNAVAILABLE_HINT,
  UPSTREAM_UNAVAILABLE_MESSAGE,
  isHtmlErrorPage,
  sanitizeAuthErrorMessage,
} from "../http/upstream-html-error.ts";
import { parseHttpResponseBody as parseResponseBody } from "../http/parse-response-body.ts";
import { buildSdkHeaderValue } from "../sdk-version.ts";
import { buildServiceRequestHeaders } from "../utils/athena-request-headers.ts";
import {
  ATHENA_AUTH_DISABLE_COOKIE_CACHE_QUERY_PARAM,
  ATHENA_AUTH_DISABLE_COOKIE_CACHE_QUERY_VALUE,
} from "../utils/athena-auth-url.ts";
import { assertAthenaAuthTemplateVariables } from "./limits.ts";
import { createAthenaAuthTokenProvider } from "./token-provider.ts";
import { resolveReactEmailPayloadFields } from "./react-email.ts";
import type {
  AthenaAdminHasPermissionRequest,
  AthenaAdminHasPermissionResponse,
  AthenaAdminRevokeUserSessionRequest,
  AthenaAdminRevokeUserSessionsRequest,
  AthenaAdminSuccessResponse,
  AthenaApiKeyDeleteAllExpiredResponse,
  AthenaAuthBindings,
  AthenaAuthCallOptions,
  AthenaAuthClientConfig,
  AthenaAuthEmailListQuery,
  AthenaAuthEmailListResponse,
  AthenaAuthEndpointPath,
  AthenaAuthErrorCode,
  AthenaAuthErrorDetails,
  AthenaAuthFetchCompatibleInput,
  AthenaAuthGenericInput,
  AthenaAuthGenericQueryInput,
  AthenaAuthGetUserResponse,
  AthenaAuthGuardResult,
  AthenaAuthHealthResponse,
  AthenaAuthLinkedAccount,
  AthenaAuthMethod,
  AthenaAuthOkResponse,
  AthenaAuthOrganization,
  AthenaAuthOrganizationBindings,
  AthenaAuthOrganizationCheckSlugRequest,
  AthenaAuthOrganizationCreateRequest,
  AthenaAuthOrganizationDeleteRequest,
  AthenaAuthOrganizationGetFullQuery,
  AthenaAuthOrganizationGetInvitationQuery,
  AthenaAuthOrganizationInvitation,
  AthenaAuthOrganizationInvitationActionRequest,
  AthenaAuthOrganizationInviteMemberRequest,
  AthenaAuthOrganizationLeaveRequest,
  AthenaAuthOrganizationListInvitationsQuery,
  AthenaAuthOrganizationListMembersQuery,
  AthenaAuthOrganizationListUserInvitationsQuery,
  AthenaAuthOrganizationMember,
  AthenaAuthOrganizationRemoveMemberRequest,
  AthenaAuthOrganizationSetActiveRequest,
  AthenaAuthOrganizationUpdateMemberRoleRequest,
  AthenaAuthOrganizationUpdateRequest,
  AthenaAuthQueryValue,
  AthenaAuthReactEmailRenderInput,
  AthenaAuthRequestInput,
  AthenaAuthResult,
  AthenaAuthSession,
  AthenaAuthSessionResponse,
  AthenaAuthSignInResponse,
  AthenaAuthSignOutResponse,
  AthenaAuthSocialRedirectResponse,
  AthenaAuthStatusResponse,
  AthenaAuthUser,
  AthenaChangeEmailRequest,
  AthenaChangePasswordRequest,
  AthenaDeleteUserCallbackRequest,
  AthenaDeleteUserRequest,
  AthenaDeleteUserResponse,
  AthenaEmailSignInRequest,
  AthenaEmailSignUpRequest,
  AthenaAuthGetTokenRequest,
  AthenaAuthToken,
  AthenaForgetPasswordRequest,
  AthenaLinkSocialRequest,
  AthenaOAuthAccountTokenRequest,
  AthenaOAuthTokenBundle,
  AthenaResetPasswordRequest,
  AthenaSendVerificationEmailRequest,
  AthenaSocialSignInRequest,
  AthenaTwoFactorGenerateBackupCodesRequest,
  AthenaTwoFactorGenerateBackupCodesResponse,
  AthenaUnlinkAccountRequest,
  AthenaUpdateUserRequest,
  AthenaUsernameSignInRequest,
  AthenaVerifyEmailRequest,
  InternalAthenaAuthModule,
} from "./types.ts";

const DEFAULT_AUTH_BASE_URL = "http://localhost:3001/api/auth";
const SDK_NAME = "xylex-group/athena-auth";
const SDK_HEADER_VALUE = buildSdkHeaderValue(SDK_NAME);

interface AuthRequestContext {
  endpoint: AthenaAuthEndpointPath;
  method: AthenaAuthMethod;
}

export interface InternalAuthModuleRuntimeOptions {
  resolveCallOptions?: () =>
    | AthenaAuthCallOptions
    | undefined
    | Promise<AthenaAuthCallOptions | undefined>;
}

type InternalErrorInput = AuthRequestContext & {
  code: AthenaAuthErrorCode;
  status: number;
  message: string;
  requestId?: string;
  hint?: string;
  cause?: string;
};

function normalizeBaseUrl(baseUrl?: string): string {
  return (baseUrl ?? DEFAULT_AUTH_BASE_URL).replace(/\/$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function resolveRequestId(headers: Headers): string | undefined {
  return (
    headers.get("x-request-id") ??
    headers.get("x-correlation-id") ??
    headers.get("x-athena-request-id") ??
    undefined
  );
}

function looksLikeUnsafeAuthTransportBody(value: string): boolean {
  const trimmed = value.trimStart();
  return (
    /^<!doctype\s+html/i.test(trimmed) ||
    /^<\?xml/i.test(trimmed) ||
    /^<html(?:\s|>)/i.test(trimmed) ||
    /<(?:head|body|script|style)(?:\s|>)/i.test(value) ||
    value.length > 2000
  );
}

function resolveErrorMessage(payload: unknown, fallback: string) {
  if (isRecord(payload)) {
    const messageCandidates = [payload.error, payload.message, payload.details];
    for (const candidate of messageCandidates) {
      if (typeof candidate === "string" && candidate.trim().length > 0) {
        const text = candidate.trim();
        if (!looksLikeUnsafeAuthTransportBody(text)) {
          return text;
        }
      }
    }
  }

  if (typeof payload === "string" && payload.trim().length > 0) {
    const text = payload.trim();
    if (looksLikeUnsafeAuthTransportBody(text)) {
      return fallback;
    }
    return sanitizeAuthErrorMessage(text, fallback);
  }

  return fallback;
}

function toErrorDetails(input: InternalErrorInput): AthenaAuthErrorDetails {
  return {
    cause: input.cause,
    code: input.code,
    endpoint: input.endpoint,
    hint: input.hint,
    message: input.message,
    method: input.method,
    requestId: input.requestId,
    status: input.status,
  };
}

function mergeCallOptions(
  base?: AthenaAuthCallOptions,
  override?: AthenaAuthCallOptions
): AthenaAuthCallOptions | undefined {
  if (!(base || override)) {
    return;
  }
  return {
    ...base,
    ...override,
    headers: {
      ...(base?.headers ?? {}),
      ...(override?.headers ?? {}),
    },
  };
}

function copyDefinedField(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  targetKey: string,
  sourceKey: string
): void {
  if (!(sourceKey in source)) {
    return;
  }
  const value = source[sourceKey];
  if (value !== undefined) {
    target[targetKey] = value;
  }
}

function normalizeEmailTemplateAttachmentsValue(value: unknown): unknown {
  if (typeof value === "string" || value === null) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeEmailTemplateAttachmentsValue(item));
  }

  if (typeof value !== "object") {
    return value;
  }

  const attachment = { ...(value as Record<string, unknown>) };
  copyDefinedField(attachment, attachment, "file_url", "fileUrl");
  attachment.fileUrl = undefined;
  return attachment;
}

function normalizeAdminEmailTemplatePayload(
  payload: Record<string, unknown>
): Record<string, unknown> {
  const normalized = { ...payload };

  copyDefinedField(normalized, payload, "template_key", "templateKey");
  copyDefinedField(normalized, payload, "event_type", "eventType");
  copyDefinedField(normalized, payload, "subject_template", "subjectTemplate");
  copyDefinedField(normalized, payload, "text_template", "textTemplate");
  copyDefinedField(normalized, payload, "html_template", "htmlTemplate");
  copyDefinedField(
    normalized,
    payload,
    "variable_bindings",
    "variableBindings"
  );
  copyDefinedField(
    normalized,
    payload,
    "attachment_failure_mode",
    "attachmentFailureMode"
  );
  copyDefinedField(normalized, payload, "is_active", "isActive");

  if (Object.hasOwn(payload, "attachments")) {
    normalized.attachments = normalizeEmailTemplateAttachmentsValue(
      payload.attachments
    );
  }

  normalized.templateKey = undefined;
  normalized.eventType = undefined;
  normalized.subjectTemplate = undefined;
  normalized.textTemplate = undefined;
  normalized.htmlTemplate = undefined;
  normalized.variableBindings = undefined;
  normalized.attachmentFailureMode = undefined;
  normalized.isActive = undefined;

  return normalized;
}

function toReactEmailTemplateCompatibilityInput<
  TInput extends AthenaAuthFetchCompatibleInput & {
    react?: AthenaAuthReactEmailRenderInput;
  },
>(input: TInput): TInput {
  const payload = input as Record<string, unknown>;
  const compatibility = { ...payload };

  copyDefinedField(compatibility, payload, "templateKey", "template_key");
  copyDefinedField(compatibility, payload, "eventType", "event_type");
  copyDefinedField(
    compatibility,
    payload,
    "subjectTemplate",
    "subject_template"
  );
  copyDefinedField(compatibility, payload, "textTemplate", "text_template");
  copyDefinedField(compatibility, payload, "htmlTemplate", "html_template");
  copyDefinedField(
    compatibility,
    payload,
    "variableBindings",
    "variable_bindings"
  );
  copyDefinedField(
    compatibility,
    payload,
    "attachmentFailureMode",
    "attachment_failure_mode"
  );
  copyDefinedField(compatibility, payload, "isActive", "is_active");

  return compatibility as unknown as TInput;
}

function normalizeAdminEmailTemplateSendPayload(
  payload: Record<string, unknown>
): Record<string, unknown> {
  const normalized = { ...payload };

  copyDefinedField(normalized, payload, "template_id", "templateId");
  copyDefinedField(normalized, payload, "recipient_email", "recipientEmail");
  copyDefinedField(normalized, payload, "render_variables", "renderVariables");
  copyDefinedField(normalized, payload, "user_id", "userId");
  copyDefinedField(normalized, payload, "organization_id", "organizationId");
  copyDefinedField(normalized, payload, "session_token", "sessionToken");
  copyDefinedField(
    normalized,
    payload,
    "attachment_failure_mode",
    "attachmentFailureMode"
  );

  if (Object.hasOwn(payload, "attachments")) {
    normalized.attachments = normalizeEmailTemplateAttachmentsValue(
      payload.attachments
    );
  }

  normalized.templateId = undefined;
  normalized.recipientEmail = undefined;
  normalized.renderVariables = undefined;
  normalized.userId = undefined;
  normalized.organizationId = undefined;
  normalized.sessionToken = undefined;
  normalized.attachmentFailureMode = undefined;

  return normalized;
}

function toSessionGuardFailure(
  sessionResult: AthenaAuthResult<AthenaAuthSessionResponse>
): AthenaAuthGuardResult {
  if (sessionResult.status === 401 || sessionResult.data === null) {
    return {
      error: sessionResult.error ?? "Unauthorized",
      ok: false,
      reason: "unauthorized",
      sessionResult,
      status: 401,
    };
  }

  return {
    error: sessionResult.error ?? "Failed to resolve current session",
    ok: false,
    reason: "upstream_error",
    sessionResult,
    status: sessionResult.status,
  };
}

function toPermissionGuardFailure(
  permissionResult: AthenaAuthResult<AthenaAdminHasPermissionResponse>,
  sessionResult: AthenaAuthResult<AthenaAuthSessionResponse>
): AthenaAuthGuardResult {
  if (permissionResult.status === 401) {
    return {
      error: permissionResult.error ?? "Unauthorized",
      ok: false,
      permissionResult,
      reason: "unauthorized",
      sessionResult,
      status: 401,
    };
  }

  if (permissionResult.status === 403) {
    return {
      error: permissionResult.error ?? "Forbidden",
      ok: false,
      permissionResult,
      reason: "forbidden",
      sessionResult,
      status: 403,
    };
  }

  return {
    error: permissionResult.error ?? "Failed to resolve permission check",
    ok: false,
    permissionResult,
    reason: "upstream_error",
    sessionResult,
    status: permissionResult.status,
  };
}

function extractQueryFromInput(
  input?: AthenaAuthFetchCompatibleInput
): Record<string, AthenaAuthQueryValue> | undefined {
  const { payload } = extractFetchOptions(input);
  const query = (payload as { query?: Record<string, AthenaAuthQueryValue> } | undefined)
    ?.query;
  if (!query || typeof query !== "object") {
    return undefined;
  }
  return query;
}

function withFreshSessionLookupQuery(
  input?: AthenaAuthFetchCompatibleInput
): Record<string, AthenaAuthQueryValue> {
  const query = extractQueryFromInput(input) ?? {};
  const explicit = query[ATHENA_AUTH_DISABLE_COOKIE_CACHE_QUERY_PARAM];
  if (explicit === false || explicit === "false") {
    const next = { ...query };
    delete next[ATHENA_AUTH_DISABLE_COOKIE_CACHE_QUERY_PARAM];
    return next;
  }
  return {
    ...query,
    [ATHENA_AUTH_DISABLE_COOKIE_CACHE_QUERY_PARAM]:
      ATHENA_AUTH_DISABLE_COOKIE_CACHE_QUERY_VALUE,
  };
}

function extractFetchOptions<
  T extends AthenaAuthFetchCompatibleInput | undefined,
>(input: T) {
  if (!input) {
    return {
      fetchOptions: undefined,
      payload: undefined,
    };
  }

  const { fetchOptions, ...rest } = input;
  const hasPayloadKeys = Object.keys(rest).length > 0;
  return {
    fetchOptions,
    payload: hasPayloadKeys ? rest : undefined,
  };
}

function buildHeaders(
  config: AthenaAuthClientConfig,
  options?: AthenaAuthCallOptions
): Record<string, string> {
  return buildServiceRequestHeaders("auth", SDK_HEADER_VALUE, config, options);
}

function appendQueryParam(
  searchParams: URLSearchParams,
  key: string,
  value: AthenaAuthQueryValue
) {
  if (value === undefined || value === null) {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => {
      searchParams.append(key, String(item));
    });
    return;
  }
  searchParams.append(key, String(value));
}

function buildRequestUrl(
  baseUrl: string,
  endpoint: AthenaAuthEndpointPath,
  query?: Record<string, AthenaAuthQueryValue>
) {
  const url = `${baseUrl}${endpoint}`;
  if (!query || Object.keys(query).length === 0) {
    return url;
  }
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    appendQueryParam(searchParams, key, value);
  }
  const queryText = searchParams.toString();
  return queryText ? `${url}?${queryText}` : url;
}

function inferDefaultMethod(
  endpoint: AthenaAuthEndpointPath
): AthenaAuthMethod {
  if (endpoint.startsWith("/reset-password/")) {
    return "GET";
  }

  switch (endpoint) {
    case "/get-session":
    case "/admin/get-user":
    case "/list-sessions":
    case "/verify-email":
    case "/change-email/verify":
    case "/delete-user/verify":
    case "/email-list":
    case "/email/list":
    case "/delete-user/callback":
    case "/list-accounts":
    case "/passkey/generate-register-options":
    case "/passkey/list-user-passkeys":
    case "/.well-known/webauthn":
    case "/.well-known/jwks.json":
    case "/.well-known/openid-configuration":
    case "/admin/list-users":
    case "/admin/athena-client/list":
    case "/admin/audit-log/list":
    case "/admin/email/get":
    case "/admin/email-failure/list":
    case "/admin/email-failure/get":
    case "/admin/email-template/get":
    case "/admin/email-template/list":
    case "/admin/email/list":
    case "/api-key/get":
    case "/api-key/list":
    case "/organization/get-full-organization":
    case "/organization/list":
    case "/organization/get-invitation":
    case "/organization/list-invitations":
    case "/organization/list-user-invitations":
    case "/organization/list-members":
    case "/organization/get-active-member":
    case "/health":
    case "/ok":
    case "/error":
      return "GET";
    default:
      return "POST";
  }
}

async function callAuthEndpoint<T>(
  config: AthenaAuthClientConfig,
  context: AuthRequestContext,
  body?: unknown,
  query?: Record<string, AthenaAuthQueryValue>,
  options?: AthenaAuthCallOptions
): Promise<AthenaAuthResult<T>> {
  const baseUrl = normalizeBaseUrl(options?.baseUrl ?? config.baseUrl);
  const url = buildRequestUrl(baseUrl, context.endpoint, query);
  const headers = buildHeaders(config, options);
  const credentials = options?.credentials ?? config.credentials ?? "include";
  const requestInit: RequestInit = {
    cache: "no-store",
    credentials,
    headers,
    method: context.method,
    signal: options?.signal,
  };

  if (context.method !== "GET") {
    requestInit.body = JSON.stringify(body ?? {});
  }

  const fetcher = config.fetch ?? globalThis.fetch;
  if (!fetcher) {
    const details = toErrorDetails({
      code: "UNKNOWN_ERROR",
      endpoint: context.endpoint,
      hint: "Use Node 18+ or provide `fetch` through createClient({ auth: { fetch } })",
      message: "No fetch implementation available for auth client",
      method: context.method,
      status: 0,
    });
    return {
      data: null,
      error: details.message,
      errorDetails: details,
      ok: false,
      raw: null,
      status: 0,
    };
  }

  try {
    const response = await fetcher(url, requestInit);
    const rawText = await response.text();
    const requestId = resolveRequestId(response.headers);
    const parsedBody = parseResponseBody(
      rawText ?? "",
      response.headers.get("content-type")
    );

    if (isHtmlErrorPage(rawText ?? "", response.headers.get("content-type"))) {
      const details = toErrorDetails({
        cause: (rawText ?? "").slice(0, 200),
        code: UPSTREAM_UNAVAILABLE_CODE,
        endpoint: context.endpoint,
        hint: UPSTREAM_UNAVAILABLE_HINT,
        message: UPSTREAM_UNAVAILABLE_MESSAGE,
        method: context.method,
        requestId,
        status: response.status || 503,
      });
      return {
        data: null,
        error: details.message,
        errorDetails: details,
        ok: false,
        raw: null,
        status: details.status,
      };
    }

    if (parsedBody.parseFailed) {
      const details = toErrorDetails({
        cause: rawText.slice(0, 300),
        code: "INVALID_JSON",
        endpoint: context.endpoint,
        hint: "Verify the auth endpoint response body is valid JSON.",
        message: "Auth server returned malformed JSON",
        method: context.method,
        requestId,
        status: response.status,
      });
      return {
        data: null,
        error: details.message,
        errorDetails: details,
        ok: false,
        raw: parsedBody.parsed,
        status: response.status,
      };
    }

    const parsed = parsedBody.parsed;

    if (!response.ok) {
      const details = toErrorDetails({
        code: "HTTP_ERROR",
        endpoint: context.endpoint,
        message: resolveErrorMessage(
          parsed,
          `Auth endpoint ${context.method} ${context.endpoint} failed with status ${response.status}`
        ),
        method: context.method,
        requestId,
        status: response.status,
      });
      return {
        data: null,
        error: details.message,
        errorDetails: details,
        ok: false,
        raw: parsed,
        status: response.status,
      };
    }

    return {
      data: (parsed as T) ?? null,
      error: null,
      errorDetails: null,
      ok: true,
      raw: parsed,
      status: response.status,
    };
  } catch (callError) {
    const message =
      callError instanceof Error ? callError.message : String(callError);
    const details = toErrorDetails({
      cause: message,
      code: "NETWORK_ERROR",
      endpoint: context.endpoint,
      hint: "Check auth server URL, DNS, and network reachability.",
      message: `Network error while calling ${context.method} ${context.endpoint}: ${message}`,
      method: context.method,
      status: 0,
    });
    return {
      data: null,
      error: details.message,
      errorDetails: details,
      ok: false,
      raw: null,
      status: 0,
    };
  }
}

function executePostWithCompatibleInput<
  TPayload extends AthenaAuthFetchCompatibleInput,
  TResult,
>(
  config: AthenaAuthClientConfig,
  context: AuthRequestContext,
  input: TPayload,
  options?: AthenaAuthCallOptions
) {
  const { payload, fetchOptions } = extractFetchOptions(input);
  const mergedOptions = mergeCallOptions(fetchOptions, options);
  return callAuthEndpoint<TResult>(
    config,
    context,
    payload ?? {},
    undefined,
    mergedOptions
  );
}

function executePostWithOptionalInput<TResult>(
  config: AthenaAuthClientConfig,
  context: AuthRequestContext,
  input?: AthenaAuthFetchCompatibleInput,
  options?: AthenaAuthCallOptions
) {
  const { fetchOptions } = extractFetchOptions(input);
  const mergedOptions = mergeCallOptions(fetchOptions, options);
  return callAuthEndpoint<TResult>(
    config,
    context,
    {},
    undefined,
    mergedOptions
  );
}

function executeGetWithCompatibleInput<TResult>(
  config: AthenaAuthClientConfig,
  context: AuthRequestContext,
  input?: AthenaAuthFetchCompatibleInput,
  options?: AthenaAuthCallOptions
) {
  const { fetchOptions } = extractFetchOptions(input);
  const mergedOptions = mergeCallOptions(fetchOptions, options);
  return callAuthEndpoint<TResult>(
    config,
    context,
    undefined,
    undefined,
    mergedOptions
  );
}

function executeGetWithQueryCompatibleInput<TQuery extends object, TResult>(
  config: AthenaAuthClientConfig,
  context: AuthRequestContext,
  input?: { query?: TQuery } & AthenaAuthFetchCompatibleInput,
  options?: AthenaAuthCallOptions
) {
  const { payload, fetchOptions } = extractFetchOptions(input);
  const mergedOptions = mergeCallOptions(fetchOptions, options);
  const query = (
    payload as { query?: Record<string, AthenaAuthQueryValue> } | undefined
  )?.query;
  return callAuthEndpoint<TResult>(
    config,
    context,
    undefined,
    query,
    mergedOptions
  );
}

/**
 * Internal auth-module assembly used by the root client factory.
 */
export function createAuthModule(
  config: AthenaAuthClientConfig = {},
  runtimeOptions: InternalAuthModuleRuntimeOptions = {}
): InternalAthenaAuthModule {
  const normalizedBaseUrl = normalizeBaseUrl(config.baseUrl);
  const resolvedConfig: AthenaAuthClientConfig = {
    ...config,
    baseUrl: normalizedBaseUrl,
  };

  const request = async <T = unknown>(
    input: AthenaAuthRequestInput,
    options?: AthenaAuthCallOptions
  ): Promise<AthenaAuthResult<T>> => {
    const method =
      input.method ??
      (input.body === undefined ? inferDefaultMethod(input.endpoint) : "POST");
    const contextOptions = await runtimeOptions.resolveCallOptions?.();
    const mergedOptions = mergeCallOptions(
      mergeCallOptions(contextOptions, input.fetchOptions),
      options
    );
    return await callAuthEndpoint<T>(
      resolvedConfig,
      { endpoint: input.endpoint, method },
      input.body,
      input.query,
      mergedOptions
    );
  };

  const postGeneric = <T = unknown>(
    endpoint: AthenaAuthEndpointPath,
    input?: AthenaAuthFetchCompatibleInput & object,
    options?: AthenaAuthCallOptions
  ) => {
    const { payload, fetchOptions } = extractFetchOptions(input);
    return request<T>(
      {
        body: payload ?? {},
        endpoint,
        fetchOptions,
        method: "POST",
      },
      options
    );
  };

  const getGeneric = <T = unknown>(
    endpoint: AthenaAuthEndpointPath,
    input?: AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions
  ) => {
    const { fetchOptions } = extractFetchOptions(input);
    return request<T>(
      {
        endpoint,
        fetchOptions,
        method: "GET",
        query:
          endpoint === "/get-session"
            ? withFreshSessionLookupQuery(input)
            : extractQueryFromInput(input),
      },
      options
    );
  };

  const getWithQuery = <
    T = unknown,
    TQuery extends object = Record<string, AthenaAuthQueryValue>,
  >(
    endpoint: AthenaAuthEndpointPath,
    input?: AthenaAuthFetchCompatibleInput & {
      query?: TQuery;
    },
    options?: AthenaAuthCallOptions
  ) => {
    const { payload, fetchOptions } = extractFetchOptions(input);
    const query = (payload as { query?: TQuery } | undefined)?.query as
      | Record<string, AthenaAuthQueryValue>
      | undefined;
    return request<T>(
      {
        endpoint,
        fetchOptions,
        method: "GET",
        query,
      },
      options
    );
  };

  const withReactEmailRoute = (route: AthenaAuthEndpointPath) => ({
    ...resolvedConfig.reactEmail,
    route,
  });

  const resolveAdminEmailPayload = <
    TInput extends AthenaAuthFetchCompatibleInput & {
      react?: AthenaAuthReactEmailRenderInput;
    },
  >(
    route: "/admin/email/create" | "/admin/email/update",
    input: TInput
  ) =>
    resolveReactEmailPayloadFields(
      input,
      {
        htmlField: "htmlBody",
        textField: "textBody",
      },
      withReactEmailRoute(route)
    );

  const resolveAdminEmailTemplatePayload = <
    TInput extends AthenaAuthFetchCompatibleInput & {
      react?: AthenaAuthReactEmailRenderInput;
    },
  >(
    route: "/admin/email-template/create" | "/admin/email-template/update",
    input: TInput
  ) =>
    resolveReactEmailPayloadFields(
      toReactEmailTemplateCompatibilityInput(input),
      {
        htmlField: "htmlTemplate",
        textField: "textTemplate",
        variablesField: "variables",
      },
      withReactEmailRoute(route)
    ).then((payload) => {
      const normalizedPayload = normalizeAdminEmailTemplatePayload(
        payload as Record<string, unknown>
      );
      if (
        "variables" in payload &&
        payload.variables !== undefined &&
        payload.variables !== null
      ) {
        assertAthenaAuthTemplateVariables(
          payload.variables,
          `${route} variables`
        );
      }
      return normalizedPayload;
    });

  const requireSession: AthenaAuthBindings["requireSession"] = async (
    input,
    options
  ) => {
    const sessionInput = input?.fetchOptions
      ? { fetchOptions: input.fetchOptions }
      : undefined;
    const sessionResult = await getGeneric<AthenaAuthSessionResponse>(
      "/get-session",
      sessionInput,
      options
    );

    if (!sessionResult.ok || sessionResult.data === null) {
      return toSessionGuardFailure(sessionResult);
    }

    return {
      ok: true,
      session: sessionResult.data,
    };
  };

  const getUser: AthenaAuthBindings["getUser"] = async (input, options) => {
    const sessionResult = await getGeneric<AthenaAuthSessionResponse>(
      "/get-session",
      input,
      options
    );

    if (!sessionResult.ok) {
      return {
        ...sessionResult,
        data: null,
      };
    }

    return {
      ...sessionResult,
      data: {
        user: sessionResult.data?.user ?? null,
      } satisfies AthenaAuthGetUserResponse,
    };
  };

  const requirePermission = async (
    endpoint: "/admin/has-permission" | "/organization/has-permission",
    input: AthenaAdminHasPermissionRequest & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions
  ): Promise<AthenaAuthGuardResult> => {
    const sessionGuard = await requireSession(
      input?.fetchOptions ? { fetchOptions: input.fetchOptions } : undefined,
      options
    );

    if (!sessionGuard.ok) {
      return sessionGuard;
    }

    const permissionResult =
      await postGeneric<AthenaAdminHasPermissionResponse>(
        endpoint,
        input,
        options
      );

    if (!permissionResult.ok) {
      return toPermissionGuardFailure(permissionResult, {
        data: sessionGuard.session,
        error: null,
        errorDetails: null,
        ok: true,
        raw: sessionGuard.session,
        status: 200,
      });
    }

    if (!permissionResult.data?.success) {
      return {
        error: permissionResult.data?.error ?? "Forbidden",
        ok: false,
        permissionResult,
        reason: "forbidden",
        sessionResult: {
          data: sessionGuard.session,
          error: null,
          errorDetails: null,
          ok: true,
          raw: sessionGuard.session,
          status: 200,
        },
        status: 403,
      };
    }

    return sessionGuard;
  };

  const listUserEmailsWithFallback: AthenaAuthBindings["user"]["email"]["list"] =
    async (input, options) => {
      const primary = await getWithQuery<
        AthenaAuthEmailListResponse,
        AthenaAuthEmailListQuery
      >("/email/list", input, options);
      if (
        primary.ok ||
        primary.status !== 404 ||
        primary.errorDetails?.code !== "HTTP_ERROR"
      ) {
        return primary;
      }
      return getWithQuery<
        AthenaAuthEmailListResponse,
        AthenaAuthEmailListQuery
      >("/email-list", input, options);
    };

  const healthWithFallback: AthenaAuthBindings["health"] = async (
    input,
    options
  ) => {
    const primary = await getGeneric<AthenaAuthHealthResponse>(
      "/health",
      input,
      options
    );
    if (
      primary.ok ||
      primary.status !== 404 ||
      primary.errorDetails?.code !== "HTTP_ERROR"
    ) {
      return primary;
    }

    const fallback = await getGeneric<AthenaAuthOkResponse>(
      "/ok",
      input,
      options
    );
    if (!fallback.ok) {
      return {
        ...fallback,
        data: null,
      };
    }

    const fallbackStatus =
      isRecord(fallback.data) && typeof fallback.data.ok === "boolean"
        ? fallback.data.ok
          ? "ok"
          : "error"
        : "ok";

    return {
      ...fallback,
      data: {
        status: fallbackStatus,
      },
    };
  };

  const sessionStore =
    createAthenaAuthSessionController<AthenaAuthSessionResponse>();
  const capabilitiesStore = createAthenaAuthCapabilitiesStore(
    config.capabilities
  );

  const capabilityDisabled = (
    feature: string,
    endpoint: AthenaAuthEndpointPath,
    method: AthenaAuthMethod = "POST"
  ): AthenaAuthResult<never> => ({
    data: null,
    error: `${feature} is not enabled on this Athena Auth runtime`,
    errorDetails: {
      code: "ATHENA_AUTH_CAPABILITY_DISABLED",
      endpoint,
      hint: feature,
      message: `${feature} is not enabled on this Athena Auth runtime`,
      method,
      status: 501,
    },
    ok: false,
    raw: {
      error: {
        code: "ATHENA_AUTH_CAPABILITY_DISABLED",
        feature,
        status: 501,
      },
    },
    status: 501,
  });

  const denySocial = (
    endpoint: AthenaAuthEndpointPath
  ): AthenaAuthResult<never> | null => {
    if (isSocialCapabilityEnabled(capabilitiesStore.getSnapshot())) {
      return null;
    }
    if (capabilitiesStore.getSnapshot().status !== "known") {
      return null;
    }
    return capabilityDisabled("social", endpoint);
  };

  const denyPasskeys = (
    endpoint: AthenaAuthEndpointPath,
    method: AthenaAuthMethod = "POST"
  ): AthenaAuthResult<never> | null => {
    const snap = capabilitiesStore.getSnapshot();
    if (snap.status !== "known" || isCapabilityEnabled(snap, "passkeys")) {
      return null;
    }
    return capabilityDisabled("passkeys", endpoint, method);
  };

  const gateCapability = <T>(
    denied: AthenaAuthResult<never> | null,
    run: () => Promise<AthenaAuthResult<T>>
  ): Promise<AthenaAuthResult<T>> =>
    denied ? Promise.resolve(denied as AthenaAuthResult<T>) : run();

    const isSessionResponse = (
      value: unknown
    ): value is AthenaAuthSessionResponse => {
      if (!value || typeof value !== "object") {
        return false;
      }
      const record = value as Record<string, unknown>;
      const session = record.session;
      const user = record.user;
      return (
        !!session &&
        typeof session === "object" &&
        typeof (session as { id?: unknown }).id === "string" &&
        !!user &&
        typeof user === "object" &&
        typeof (user as { id?: unknown }).id === "string"
      );
    };

    const sessionFromSignIn = (
      value: unknown
    ): AthenaAuthSessionResponse | null => {
      if (!value || typeof value !== "object") {
        return null;
      }
      const record = value as Record<string, unknown>;
      if (record.redirect === true) {
        return null;
      }
      const user = record.user;
      const token = record.token;
      if (
        !user ||
        typeof user !== "object" ||
        typeof (user as { id?: unknown }).id !== "string"
      ) {
        return null;
      }
      const userId = (user as { id: string }).id;
      const sessionToken = typeof token === "string" ? token : undefined;
      return {
        user: user as AthenaAuthUser,
        session: {
          id: sessionToken ?? `local:${userId}`,
          token: sessionToken,
          userId,
        },
      };
    };

    const fetchSessionResult = (
      input?: AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions
    ) =>
      getGeneric<AthenaAuthSessionResponse>("/get-session", input, options);

    const refreshSessionStore = async (
      input?: AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions
    ) => {
      const { epoch, skipped } = sessionStore.beginRefresh();
      if (skipped) {
        return sessionStore.getSnapshot();
      }
      try {
        const result = await fetchSessionResult(input, options);
        if (result.ok) {
          sessionStore.completeRefresh(epoch, {
            ok: true,
            session: result.data ?? null,
          });
        } else {
          const status = typeof result.status === "number" ? result.status : 0;
          sessionStore.completeRefresh(epoch, {
            ok: false,
            error: result.error ?? result,
            clearSession: status === 401,
          });
        }
      } catch (error) {
        sessionStore.completeRefresh(epoch, {
          ok: false,
          error,
          clearSession: false,
        });
      }
      return sessionStore.getSnapshot();
    };

    /**
     * After auth mutations, keep SSOT store current without bespoke app bridges.
     * Prefer embedded session payloads; otherwise refresh once.
     */
    const applyAuthMutationToSessionStore = async <T>(
      result: AthenaAuthResult<T>,
      options?: { refreshIfMissing?: boolean }
    ): Promise<AthenaAuthResult<T>> => {
      if (!result.ok) {
        return result;
      }
      if (isSessionResponse(result.data)) {
        sessionStore.accept(result.data);
        return result;
      }
      const fromSignIn = sessionFromSignIn(result.data);
      if (fromSignIn) {
        sessionStore.accept(fromSignIn);
        return result;
      }
      if (options?.refreshIfMissing !== false) {
        await refreshSessionStore();
      }
      return result;
    };

    const patchActiveOrganization = (
      organizationId: string | null | undefined
    ) => {
      const current = sessionStore.getSnapshot().session;
      if (!current?.session) {
        return false;
      }
      sessionStore.accept({
        ...current,
        session: {
          ...current.session,
          activeOrganizationId:
            organizationId === undefined ? null : organizationId,
        },
      });
      return true;
    };

    const signOut = async (
      input?: AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions
    ) => {
      // Cancel in-flight refresh immediately (INV-Q).
      sessionStore.invalidate("signOut");
      return executePostWithOptionalInput<AthenaAuthSignOutResponse>(
        resolvedConfig,
        { endpoint: "/sign-out", method: "POST" },
        input,
        options
      );
    };

    const getSession = async (
      input?: AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions
    ): Promise<AthenaAuthResult<AthenaAuthSessionResponse>> => {
      // Epoch-gated via beginRefresh so setActive/signOut win over stale reads.
      const { epoch, skipped } = sessionStore.beginRefresh();
      if (skipped) {
        const snap = sessionStore.getSnapshot();
        const ok =
          snap.status === "authenticated" || snap.status === "unauthenticated";
        return {
          data: snap.session,
          error: ok
            ? null
            : snap.error != null
              ? String(
                  snap.error instanceof Error ? snap.error.message : snap.error
                )
              : "session_loading",
          ok,
          raw: snap.session,
          status: ok ? 200 : snap.status === "error" ? 502 : 0,
        };
      }
      try {
        const result = await fetchSessionResult(input, options);
        if (result.ok) {
          sessionStore.completeRefresh(epoch, {
            ok: true,
            session: result.data ?? null,
          });
        } else {
          const status = typeof result.status === "number" ? result.status : 0;
          sessionStore.completeRefresh(epoch, {
            ok: false,
            error: result.error ?? result,
            clearSession: status === 401,
          });
        }
        return result;
      } catch (error) {
        sessionStore.completeRefresh(epoch, {
          ok: false,
          error,
          clearSession: false,
        });
        throw error;
      }
    };
  const revokeSessions = (
    input?: AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions
  ) =>
    executePostWithOptionalInput<AthenaAuthStatusResponse>(
      resolvedConfig,
      { endpoint: "/revoke-sessions", method: "POST" },
      input,
      options
    );

  const revokeOtherSessions = (
    input?: AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions
  ) =>
    executePostWithOptionalInput<AthenaAuthStatusResponse>(
      resolvedConfig,
      { endpoint: "/revoke-other-sessions", method: "POST" },
      input,
      options
    );

  const revokeSession = (
    input: { token: string } & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions
  ) =>
    executePostWithCompatibleInput<typeof input, AthenaAuthStatusResponse>(
      resolvedConfig,
      { endpoint: "/revoke-session", method: "POST" },
      input,
      options
    );

  const deleteUser = async (
    input?: AthenaDeleteUserRequest & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions
  ) => {
    const { payload, fetchOptions } = extractFetchOptions(input);
    const mergedOptions = mergeCallOptions(fetchOptions, options);
    const result = await callAuthEndpoint<AthenaDeleteUserResponse>(
      resolvedConfig,
      { endpoint: "/delete-user", method: "POST" },
      payload ?? {},
      undefined,
      mergedOptions
    );
    if (result.ok) {
      sessionStore.invalidate("revoke");
    }
    return result;
  };

  const deleteUserCallback = (
    input?: AthenaDeleteUserCallbackRequest & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions
  ) => {
    const { payload, fetchOptions } = extractFetchOptions(input);
    const mergedOptions = mergeCallOptions(fetchOptions, options);
    const query = (payload ?? {}) as AthenaDeleteUserCallbackRequest;
    return callAuthEndpoint<AthenaDeleteUserResponse>(
      resolvedConfig,
      { endpoint: "/delete-user/callback", method: "GET" },
      undefined,
      {
        callbackURL: query.callbackURL,
        token: query.token,
      },
      mergedOptions
    );
  };

  const resolveResetPasswordToken = (
    input: {
      token: string;
      callbackURL?: string;
    } & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions
  ) => {
    const { payload, fetchOptions } = extractFetchOptions(input);
    const mergedOptions = mergeCallOptions(fetchOptions, options);
    const query = payload as
      | { token?: string; callbackURL?: string }
      | undefined;
    const token = query?.token?.trim();
    if (!token) {
      throw new Error("resolveResetPasswordToken requires a non-empty token");
    }
    const endpoint =
      `/reset-password/${encodeURIComponent(token)}` as AthenaAuthEndpointPath;
    return callAuthEndpoint<{ token?: string }>(
      resolvedConfig,
      { endpoint, method: "GET" },
      undefined,
      query?.callbackURL ? { callbackURL: query.callbackURL } : undefined,
      mergedOptions
    );
  };

  const organization: AthenaAuthOrganizationBindings = {
    checkSlug: (input, options) =>
      executePostWithCompatibleInput<
        AthenaAuthOrganizationCheckSlugRequest & AthenaAuthFetchCompatibleInput,
        { available: boolean }
      >(
        resolvedConfig,
        { endpoint: "/organization/check-slug", method: "POST" },
        input,
        options
      ),
    create: (input, options) =>
      executePostWithCompatibleInput<
        AthenaAuthOrganizationCreateRequest & AthenaAuthFetchCompatibleInput,
        AthenaAuthOrganization
      >(
        resolvedConfig,
        { endpoint: "/organization/create", method: "POST" },
        input,
        options
      ),
    delete: (input, options) =>
      executePostWithCompatibleInput<
        AthenaAuthOrganizationDeleteRequest & AthenaAuthFetchCompatibleInput,
        AthenaAuthStatusResponse
      >(
        resolvedConfig,
        { endpoint: "/organization/delete", method: "POST" },
        input,
        options
      ),
    getFull: (input, options) =>
      executeGetWithQueryCompatibleInput<
        AthenaAuthOrganizationGetFullQuery,
        {
          organization: AthenaAuthOrganization;
          members?: AthenaAuthOrganizationMember[];
          invitations?: AthenaAuthOrganizationInvitation[];
        }
      >(
        resolvedConfig,
        { endpoint: "/organization/get-full-organization", method: "GET" },
        input,
        options
      ),
    hasPermission: (input, options) =>
      postGeneric<AthenaAdminHasPermissionResponse>(
        "/organization/has-permission",
        input,
        options
      ),
    invitation: {
      accept: (input, options) =>
        executePostWithCompatibleInput<
          AthenaAuthOrganizationInvitationActionRequest &
            AthenaAuthFetchCompatibleInput,
          AthenaAuthStatusResponse
        >(
          resolvedConfig,
          { endpoint: "/organization/accept-invitation", method: "POST" },
          input,
          options
        ),
      cancel: (input, options) =>
        executePostWithCompatibleInput<
          AthenaAuthOrganizationInvitationActionRequest &
            AthenaAuthFetchCompatibleInput,
          AthenaAuthStatusResponse
        >(
          resolvedConfig,
          { endpoint: "/organization/cancel-invitation", method: "POST" },
          input,
          options
        ),
      get: (input, options) =>
        executeGetWithQueryCompatibleInput<
          AthenaAuthOrganizationGetInvitationQuery,
          AthenaAuthOrganizationInvitation
        >(
          resolvedConfig,
          { endpoint: "/organization/get-invitation", method: "GET" },
          input,
          options
        ),
      list: (input, options) =>
        executeGetWithQueryCompatibleInput<
          AthenaAuthOrganizationListInvitationsQuery,
          AthenaAuthOrganizationInvitation[]
        >(
          resolvedConfig,
          { endpoint: "/organization/list-invitations", method: "GET" },
          input,
          options
        ),
      reject: (input, options) =>
        executePostWithCompatibleInput<
          AthenaAuthOrganizationInvitationActionRequest &
            AthenaAuthFetchCompatibleInput,
          AthenaAuthStatusResponse
        >(
          resolvedConfig,
          { endpoint: "/organization/reject-invitation", method: "POST" },
          input,
          options
        ),
    },
    leave: (input, options) =>
      executePostWithCompatibleInput<
        AthenaAuthOrganizationLeaveRequest & AthenaAuthFetchCompatibleInput,
        AthenaAuthStatusResponse
      >(
        resolvedConfig,
        { endpoint: "/organization/leave", method: "POST" },
        input,
        options
      ),
    list: (input, options) =>
      getGeneric<AthenaAuthOrganization[]>(
        "/organization/list",
        input,
        options
      ),
    listUserInvitations: (input, options) =>
      executeGetWithQueryCompatibleInput<
        AthenaAuthOrganizationListUserInvitationsQuery,
        AthenaAuthOrganizationInvitation[]
      >(
        resolvedConfig,
        { endpoint: "/organization/list-user-invitations", method: "GET" },
        input,
        options
      ),
    member: {
      getActive: (input, options) =>
        executeGetWithCompatibleInput<AthenaAuthOrganizationMember>(
          resolvedConfig,
          { endpoint: "/organization/get-active-member", method: "GET" },
          input,
          options
        ),
      invite: (input, options) =>
        executePostWithCompatibleInput<
          AthenaAuthOrganizationInviteMemberRequest &
            AthenaAuthFetchCompatibleInput,
          AthenaAuthOrganizationInvitation
        >(
          resolvedConfig,
          { endpoint: "/organization/invite-member", method: "POST" },
          input,
          options
        ),
      list: (input, options) =>
        executeGetWithQueryCompatibleInput<
          AthenaAuthOrganizationListMembersQuery,
          AthenaAuthOrganizationMember[]
        >(
          resolvedConfig,
          { endpoint: "/organization/list-members", method: "GET" },
          input,
          options
        ),
      remove: (input, options) =>
        executePostWithCompatibleInput<
          AthenaAuthOrganizationRemoveMemberRequest &
            AthenaAuthFetchCompatibleInput,
          AthenaAuthStatusResponse
        >(
          resolvedConfig,
          { endpoint: "/organization/remove-member", method: "POST" },
          input,
          options
        ),
      updateRole: (input, options) =>
        executePostWithCompatibleInput<
          AthenaAuthOrganizationUpdateMemberRoleRequest &
            AthenaAuthFetchCompatibleInput,
          AthenaAuthStatusResponse
        >(
          resolvedConfig,
          { endpoint: "/organization/update-member-role", method: "POST" },
          input,
          options
        ),
    },
    requirePermission: (input, options) =>
      requirePermission("/organization/has-permission", input, options),
    setActive: async (input, options) => {
          const result = await executePostWithCompatibleInput<
        AthenaAuthOrganizationSetActiveRequest & AthenaAuthFetchCompatibleInput,
        AthenaAuthStatusResponse
      >(
        resolvedConfig,
        { endpoint: "/organization/set-active", method: "POST" },
        input,
        options
          );
          if (!result.ok) {
            return result;
          }
          const organizationId =
            input && typeof input === "object" && "organizationId" in input
              ? (input as AthenaAuthOrganizationSetActiveRequest).organizationId
              : undefined;
          if (isSessionResponse(result.data)) {
            sessionStore.accept(result.data);
          }
          // Optimistic patch cancels in-flight getSession (INV-Q stale org).
          patchActiveOrganization(organizationId ?? null);
          // Always re-read live session. Cookie-cache get-session would snap
          // the store back to the previous organization.
          await refreshSessionStore();
          return result;
        },
    update: (input, options) =>
      executePostWithCompatibleInput<
        AthenaAuthOrganizationUpdateRequest & AthenaAuthFetchCompatibleInput,
        AthenaAuthOrganization
      >(
        resolvedConfig,
        { endpoint: "/organization/update", method: "POST" },
        input,
        options
      ),
  };

  const authResetPassword = Object.assign(
    (
      input: AthenaResetPasswordRequest & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions
    ) =>
      executePostWithCompatibleInput<
        AthenaResetPasswordRequest & AthenaAuthFetchCompatibleInput,
        AthenaAuthStatusResponse
      >(
        resolvedConfig,
        { endpoint: "/reset-password", method: "POST" },
        input,
        options
      ),
    {
      token: resolveResetPasswordToken,
    }
  );

  const collectRevokeTokens = (
    input: Parameters<AthenaAuthBindings["session"]["revoke"]>[0]
  ): string[] => {
    if (Array.isArray(input)) {
      return input
        .map((item) =>
          typeof item === "string"
            ? item
            : typeof (item as { token?: string })?.token === "string"
              ? (item as { token: string }).token
              : ""
        )
        .filter((token) => token.trim().length > 0);
    }
    if (!input || typeof input !== "object") {
      return [];
    }
    const parsed = input as { token?: string; tokens?: string[] };
    if (Array.isArray(parsed.tokens)) {
      return parsed.tokens.filter((token) => token.trim().length > 0);
    }
    if (typeof parsed.token === "string" && parsed.token.trim().length > 0) {
      return [parsed.token];
    }
    return [];
  };

  const executeSessionRevoke: AthenaAuthBindings["session"]["revoke"] = (
    input,
    options
  ) => {
    if (Array.isArray(input)) {
      if (input.length === 0) {
        throw new Error("session.revoke requires at least one session token");
      }
      if (input.length === 1) {
        return revokeSession(input[0], options);
      }
      return revokeSessions(undefined, options);
    }

    const parsed = input as AthenaAuthGenericInput & {
      token?: string;
      tokens?: string[];
    };
    const tokens = Array.isArray(parsed.tokens)
      ? parsed.tokens.filter((token) => token.trim().length > 0)
      : undefined;

    if (tokens && tokens.length > 1) {
      return revokeSessions(
        parsed.fetchOptions ? { fetchOptions: parsed.fetchOptions } : undefined,
        options
      );
    }

    if (tokens && tokens.length === 1) {
      return revokeSession(
        { fetchOptions: parsed.fetchOptions, token: tokens[0] },
        options
      );
    }

    const token = parsed.token?.trim();
    if (!token) {
      throw new Error(
        "session.revoke requires a non-empty token or a non-empty token list"
      );
    }

    return revokeSession(
      {
        fetchOptions: parsed.fetchOptions,
        token,
      },
      options
    );
  };

  const sessionRevokeBinding: AthenaAuthBindings["session"]["revoke"] = async (
    input,
    options
  ) => {
    const tokens = collectRevokeTokens(input);
    const result = await executeSessionRevoke(input, options);
    const revokedAll =
      (Array.isArray(input) && input.length > 1) || tokens.length > 1;
    if (
      result.ok &&
      (revokedAll || sessionStore.shouldInvalidateForRevokedTokens(tokens))
    ) {
      sessionStore.invalidate("revoke");
    }
    return result;
  };

  const adminUserSessionRevokeBinding: AthenaAuthBindings["admin"]["user"]["session"]["revoke"] =
    (input, options) => {
      const requireUserId = (userId: string | undefined): string => {
        const trimmed = String(userId ?? "").trim();
        if (!trimmed) {
          throw new Error(
            "admin.user.session.revoke requires a non-empty userId"
          );
        }
        return trimmed;
      };

      const requireSinglePluralUserId = (
        sessions: AthenaAdminRevokeUserSessionRequest[]
      ): AthenaAdminRevokeUserSessionsRequest => {
        const uniqueUserIds = [
          ...new Set(sessions.map((session) => requireUserId(session.userId))),
        ];
        if (uniqueUserIds.length !== 1) {
          throw new Error(
            "admin.user.session.revoke requires the same userId across plural payloads"
          );
        }
        return { userId: uniqueUserIds[0] };
      };

      if (Array.isArray(input)) {
        if (input.length === 0) {
          throw new Error(
            "admin.user.session.revoke requires at least one payload item"
          );
        }
        if (input.length === 1) {
          return postGeneric<AthenaAdminSuccessResponse>(
            "/admin/revoke-user-session",
            {
              ...input[0],
              userId: requireUserId(input[0].userId),
            } as AthenaAuthGenericInput,
            options
          );
        }
        return postGeneric<AthenaAdminSuccessResponse>(
          "/admin/revoke-user-sessions",
          requireSinglePluralUserId(input),
          options
        );
      }

      const parsed = input as AthenaAuthGenericInput & {
        sessions?: AthenaAdminRevokeUserSessionRequest[];
        sessionToken?: string;
        userId?: string;
      };
      const sessions = parsed.sessions;

      if (sessions && sessions.length === 0) {
        throw new Error(
          "admin.user.session.revoke requires at least one payload item"
        );
      }

      if (sessions && sessions.length === 1) {
        return postGeneric<AthenaAdminSuccessResponse>(
          "/admin/revoke-user-session",
          {
            ...sessions[0],
            fetchOptions: parsed.fetchOptions,
            userId: requireUserId(sessions[0].userId),
          } as AthenaAuthGenericInput,
          options
        );
      }

      if (sessions && sessions.length > 1) {
        return postGeneric<AthenaAdminSuccessResponse>(
          "/admin/revoke-user-sessions",
          {
            ...requireSinglePluralUserId(sessions),
            fetchOptions: parsed.fetchOptions,
          } as AthenaAuthGenericInput,
          options
        );
      }

      const normalizedUserId = requireUserId(parsed.userId);

      if (!parsed.sessionToken) {
        return postGeneric<AthenaAdminSuccessResponse>(
          "/admin/revoke-user-sessions",
          {
            fetchOptions: parsed.fetchOptions,
            userId: normalizedUserId,
          } as AthenaAuthGenericInput,
          options
        );
      }
      return postGeneric<AthenaAdminSuccessResponse>(
        "/admin/revoke-user-session",
        {
          ...parsed,
          userId: normalizedUserId,
        } as AthenaAuthGenericInput,
        options
      );
    };

  const auth: AthenaAuthBindings = {
    account: {
      list: (input, options) => getGeneric("/list-accounts", input, options),
      unlink: (input, options) =>
        postGeneric("/unlink-account", input, options),
    },
    admin: {
      apiKey: {
        create: (input, options) =>
          postGeneric("/admin/api-key/create", input, options),
      },
      athenaClient: {
        create: (input, options) =>
          postGeneric("/admin/athena-client/create", input, options),
        list: (input, options) =>
          getWithQuery("/admin/athena-client/list", input, options),
      },
      auditLog: {
        list: (input, options) =>
          getWithQuery("/admin/audit-log/list", input, options),
      },
      email: {
        create: async (input, options) =>
          postGeneric(
            "/admin/email/create",
            await resolveAdminEmailPayload("/admin/email/create", input),
            options
          ),
        delete: (input, options) =>
          postGeneric("/admin/email/delete", input, options),
        eventType: {
          list: (input, options) =>
            getWithQuery("/admin/email-event-type/list", input, options),
        },
        failure: {
          create: (input, options) =>
            postGeneric("/admin/email-failure/create", input, options),
          delete: (input, options) =>
            postGeneric("/admin/email-failure/delete", input, options),
          get: (input, options) =>
            getWithQuery("/admin/email-failure/get", input, options),
          list: (input, options) =>
            getWithQuery("/admin/email-failure/list", input, options),
          update: (input, options) =>
            postGeneric("/admin/email-failure/update", input, options),
        },
        get: (input, options) =>
          getWithQuery("/admin/email/get", input, options),
        list: (input, options) =>
          getWithQuery("/admin/email/list", input, options),
        template: {
          create: async (input, options) =>
            postGeneric(
              "/admin/email-template/create",
              await resolveAdminEmailTemplatePayload(
                "/admin/email-template/create",
                input
              ),
              options
            ),
          delete: (input, options) =>
            postGeneric("/admin/email-template/delete", input, options),
          get: (input, options) =>
            getWithQuery("/admin/email-template/get", input, options),
          list: (input, options) =>
            getWithQuery("/admin/email-template/list", input, options),
          send: (input, options) =>
            postGeneric(
              "/admin/email-template/send",
              normalizeAdminEmailTemplateSendPayload(
                extractFetchOptions(input).payload as Record<string, unknown>
              ),
              options
            ),
          update: async (input, options) =>
            postGeneric(
              "/admin/email-template/update",
              await resolveAdminEmailTemplatePayload(
                "/admin/email-template/update",
                input
              ),
              options
            ),
        },
        update: async (input, options) =>
          postGeneric(
            "/admin/email/update",
            await resolveAdminEmailPayload("/admin/email/update", input),
            options
          ),
      },
      emailEventType: {
        list: (input, options) =>
          getWithQuery("/admin/email-event-type/list", input, options),
      },
      emailTemplate: {
        create: async (input, options) =>
          postGeneric(
            "/admin/email-template/create",
            await resolveAdminEmailTemplatePayload(
              "/admin/email-template/create",
              input
            ),
            options
          ),
        delete: (input, options) =>
          postGeneric("/admin/email-template/delete", input, options),
        get: (input, options) =>
          getWithQuery("/admin/email-template/get", input, options),
        list: (input, options) =>
          getWithQuery("/admin/email-template/list", input, options),
        send: (input, options) =>
          postGeneric(
            "/admin/email-template/send",
            normalizeAdminEmailTemplateSendPayload(
              extractFetchOptions(input).payload as Record<string, unknown>
            ),
            options
          ),
        update: async (input, options) =>
          postGeneric(
            "/admin/email-template/update",
            await resolveAdminEmailTemplatePayload(
              "/admin/email-template/update",
              input
            ),
            options
          ),
      },
      hasPermission: (input, options) =>
        postGeneric<AthenaAdminHasPermissionResponse>(
          "/admin/has-permission",
          input,
          options
        ),
      requirePermission: (input, options) =>
        requirePermission("/admin/has-permission", input, options),
      listUsers: (input, options) =>
        getWithQuery("/admin/list-users", input, options),
      getUser: (input, options) =>
        getWithQuery("/admin/get-user", input, options),
      createUser: (input, options) =>
        postGeneric("/admin/create-user", input, options),
      updateUser: (input, options) =>
        postGeneric("/admin/update-user", input, options),
      setRole: (input, options) => postGeneric("/admin/set-role", input, options),
      banUser: (input, options) => postGeneric("/admin/ban-user", input, options),
      unbanUser: (input, options) =>
        postGeneric("/admin/unban-user", input, options),
      revokeUserSessions: adminUserSessionRevokeBinding,
      removeUser: (input, options) =>
        postGeneric("/admin/remove-user", input, options),
      impersonateUser: (input, options) =>
        postGeneric("/admin/impersonate-user", input, options),
      stopImpersonating: (input, options) =>
        postGeneric("/admin/stop-impersonating", input, options),
      role: {
        set: (input, options) => postGeneric("/admin/set-role", input, options),
      },
      user: {
        get: (input, options) =>
          getWithQuery("/admin/get-user", input, options),
        update: (input, options) =>
          postGeneric("/admin/update-user", input, options),
        ban: (input, options) => postGeneric("/admin/ban-user", input, options),
        create: (input, options) =>
          postGeneric("/admin/create-user", input, options),
        impersonate: (input, options) =>
          postGeneric("/admin/impersonate-user", input, options),
        list: (input, options) =>
          getWithQuery("/admin/list-users", input, options),
        remove: (input, options) =>
          postGeneric("/admin/remove-user", input, options),
        session: {
          list: (input, options) =>
            postGeneric("/admin/list-user-sessions", input, options),
          revoke: adminUserSessionRevokeBinding,
        },
        setPassword: (input, options) =>
          postGeneric("/admin/set-user-password", input, options),
        stopImpersonating: (input, options) =>
          postGeneric("/admin/stop-impersonating", input, options),
        unban: (input, options) =>
          postGeneric("/admin/unban-user", input, options),
      },
    },
    apiKey: {
      create: (input, options) =>
        postGeneric("/api-key/create", input, options),
      delete: (input, options) =>
        postGeneric("/api-key/delete", input, options),
      deleteAllExpired: (input, options) =>
        executePostWithOptionalInput<AthenaApiKeyDeleteAllExpiredResponse>(
          resolvedConfig,
          { endpoint: "/api-key/delete-all-expired-api-keys", method: "POST" },
          input,
          options
        ),
      get: (input, options) => getWithQuery("/api-key/get", input, options),
      list: (input, options) => getWithQuery("/api-key/list", input, options),
      update: (input, options) =>
        postGeneric("/api-key/update", input, options),
      verify: (input, options) =>
        postGeneric("/api-key/verify", input, options),
    },
    callback: {
      provider: (input, options) => {
        const { payload, fetchOptions } = extractFetchOptions(input);
        const parsed = payload as
          | {
              provider?: string;
              code?: string;
              state?: string;
            }
          | undefined;
        const provider = String(parsed?.provider ?? "").trim();
        if (!provider) {
          throw new Error(
            "callback.provider requires a non-empty provider value"
          );
        }
        const code = String(parsed?.code ?? "").trim();
        const state = String(parsed?.state ?? "").trim();
        if (!(code && state)) {
          throw new Error(
            "callback.provider requires non-empty code and state values"
          );
        }
        const endpoint =
          `/callback/${encodeURIComponent(provider)}` as AthenaAuthEndpointPath;
        return request(
          {
            endpoint,
            fetchOptions,
            method: "GET",
            query: {
              code,
              state,
            },
          },
          options
        );
      },
    },
    changeEmail: (input, options) =>
      postGeneric("/change-email", input, options),
    changeEmailVerify: (input, options) =>
      getWithQuery("/change-email/verify", input, options),
    changePassword: (input, options) =>
      postGeneric("/change-password", input, options),
    deleteUser: {
      callback: deleteUserCallback,
    },
    deleteUserVerify: (input, options) =>
      getWithQuery("/delete-user/verify", input, options),
    error: (input, options) => getGeneric("/error", input, options),
    forgetPassword: (input, options) =>
      postGeneric("/forget-password", input, options),
    getAccessToken: (input, options) =>
      postGeneric("/get-access-token", input, options),
    getToken: (input, options) => postGeneric("/token", input, options),
    tokenProvider: (options) =>
      createAthenaAuthTokenProvider(
        (input, callOptions) => postGeneric("/token", input, callOptions),
        options
      ),
    getSession,
    getUser,
    health: healthWithFallback,
    linkSocial: (input, options) => postGeneric("/link-social", input, options),
    listAccounts: (input, options) =>
      getGeneric("/list-accounts", input, options),
    // Better Auth UI flat method aliases (also nested under session/account/social/user).
    listSessions: (input, options) =>
      getGeneric("/list-sessions", input, options),
    ok: (input, options) => getGeneric("/ok", input, options),
    organization,
    passkey: {
      deletePasskey: (input, options) =>
        gateCapability(denyPasskeys("/passkey/delete-passkey"), () =>
          postGeneric("/passkey/delete-passkey", input, options)
        ),
      generateAuthenticateOptions: (input, options) =>
        gateCapability(
          denyPasskeys("/passkey/generate-authenticate-options"),
          () =>
            postGeneric(
              "/passkey/generate-authenticate-options",
              input,
              options
            )
        ),
      generateRegisterOptions: (input, options) =>
        gateCapability(
          denyPasskeys("/passkey/generate-register-options", "GET"),
          () => getGeneric("/passkey/generate-register-options", input, options)
        ),
      getRelatedOrigins: (input, options) =>
        getGeneric("/.well-known/webauthn", input, options),
      listUserPasskeys: (input, options) =>
        gateCapability(denyPasskeys("/passkey/list-user-passkeys", "GET"), () =>
          getWithQuery("/passkey/list-user-passkeys", input, options)
        ),
      updatePasskey: (input, options) =>
        gateCapability(denyPasskeys("/passkey/update-passkey"), () =>
          postGeneric("/passkey/update-passkey", input, options)
        ),
      verifyAuthentication: (input, options) =>
        gateCapability(denyPasskeys("/passkey/verify-authentication"), () =>
          postGeneric("/passkey/verify-authentication", input, options)
        ),
      verifyRegistration: (input, options) =>
        gateCapability(denyPasskeys("/passkey/verify-registration"), () =>
          postGeneric("/passkey/verify-registration", input, options)
        ),
    },
    refreshToken: (input, options) =>
      postGeneric("/refresh-token", input, options),
    requireSession,
    resetPassword: authResetPassword,
    revokeOtherSessions,
    revokeSession: sessionRevokeBinding,
    sendVerificationEmail: (input, options) =>
      postGeneric("/send-verification-email", input, options),
    session: {
      list: (input, options) => getGeneric("/list-sessions", input, options),
      revoke: sessionRevokeBinding,
      revokeOther: revokeOtherSessions,
      // SSOT snapshot store (H7)
      getSnapshot: () => sessionStore.getSnapshot(),
      get: () => sessionStore.getSnapshot().session,
          /**
           * Authoritative local write (org switch, sign-in payload apply).
           * Cancels in-flight refresh (INV-Q). Prefer mutation helpers that
           * already call this; advanced UI adapters may use it directly.
           */
          setSession: (
            session: Parameters<typeof sessionStore.setSession>[0],
            status?: Parameters<typeof sessionStore.setSession>[1]
          ) => sessionStore.setSession(session, status),
          invalidate: (reason?: "signOut" | "revoke" | "manual") =>
            sessionStore.invalidate(reason),
          refresh: refreshSessionStore,
          subscribe: (
            listener: (snapshot: ReturnType<typeof sessionStore.getSnapshot>) => void
          ) => sessionStore.subscribe(listener),
        },
    capabilities: {
      get: capabilitiesStore.get,
      getSnapshot: capabilitiesStore.getSnapshot,
      set: (next: Parameters<typeof capabilitiesStore.set>[0]) =>
        capabilitiesStore.set(next),
      merge: (
        patch: Parameters<typeof capabilitiesStore.merge>[0],
        meta?: Parameters<typeof capabilitiesStore.merge>[1]
      ) => capabilitiesStore.merge(patch, meta),
      markUnknown: (source?: Parameters<typeof capabilitiesStore.markUnknown>[0]) =>
        capabilitiesStore.markUnknown(source),
      subscribe: (listener: (value: ReturnType<typeof capabilitiesStore.get>) => void) =>
        capabilitiesStore.subscribe(listener),
    },
    setPassword: (input, options) =>
      postGeneric("/set-password", input, options),
    signIn: {
          email: async (input, options) =>
            applyAuthMutationToSessionStore(
              await postGeneric("/sign-in/email", input, options)
            ),
          social: (input, options) =>
            gateCapability(denySocial("/sign-in/social"), async () =>
              applyAuthMutationToSessionStore(
                await postGeneric("/sign-in/social", input, options),
                // Redirect-only social starts leave session unchanged.
                { refreshIfMissing: false }
              )
            ),
          username: async (input, options) =>
            applyAuthMutationToSessionStore(
              await postGeneric("/sign-in/username", input, options)
            ),
        },
        signOut,
        signUp: {
          email: async (input, options) =>
            applyAuthMutationToSessionStore(
              await postGeneric("/sign-up/email", input, options)
            ),
        },
        social: {
          link: (input, options) =>
            gateCapability(denySocial("/link-social"), () =>
              postGeneric("/link-social", input, options)
            ),
          signIn: (
            input: AthenaSocialSignInRequest & AthenaAuthFetchCompatibleInput,
            options?: AthenaAuthCallOptions
          ) =>
            gateCapability(denySocial("/sign-in/social"), async () =>
              applyAuthMutationToSessionStore(
                await postGeneric("/sign-in/social", input, options),
                { refreshIfMissing: false }
              )
            ),
        },
    twoFactor: {
      disable: (input, options) =>
        postGeneric("/two-factor/disable", input, options),
      enable: (input, options) =>
        postGeneric("/two-factor/enable", input, options),
      generateBackupCodes: (input, options) =>
        executePostWithCompatibleInput<
          AthenaTwoFactorGenerateBackupCodesRequest &
            AthenaAuthFetchCompatibleInput,
          AthenaTwoFactorGenerateBackupCodesResponse
        >(
          resolvedConfig,
          { endpoint: "/two-factor/generate-backup-codes", method: "POST" },
          input,
          options
        ),
      getTotpUri: (input, options) =>
        postGeneric("/two-factor/get-totp-uri", input, options),
      sendOtp: (input, options) =>
        postGeneric("/two-factor/send-otp", input, options),
      verifyBackupCode: (input, options) =>
        postGeneric("/two-factor/verify-backup-code", input, options),
      verifyOtp: (input, options) =>
        postGeneric("/two-factor/verify-otp", input, options),
      verifyTotp: (input, options) =>
        postGeneric("/two-factor/verify-totp", input, options),
    },
    unlinkAccount: (input, options) =>
      postGeneric("/unlink-account", input, options),
    updateUser: async (input, options) =>
          applyAuthMutationToSessionStore(
            await postGeneric("/update-user", input, options),
            { refreshIfMissing: true }
          ),
        user: {
          delete: deleteUser,
          email: {
            list: listUserEmailsWithFallback,
          },
          update: async (input, options) =>
            applyAuthMutationToSessionStore(
              await postGeneric("/update-user", input, options),
              { refreshIfMissing: true }
            ),
        },
    verifyEmail: (input, options) => {
      const queryInput: AthenaAuthGenericQueryInput = {
        fetchOptions: input.fetchOptions,
        query: {
          callbackURL: input.callbackURL,
          token: input.token,
        },
      };
      return getWithQuery<{ user: AthenaAuthUser; status: boolean }>(
        "/verify-email",
        queryInput,
        options
      );
    },
  };

  return {
    auth,
    baseUrl: normalizedBaseUrl,
    changeEmail: (
      input: AthenaChangeEmailRequest & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions
    ) =>
      executePostWithCompatibleInput<
        AthenaChangeEmailRequest & AthenaAuthFetchCompatibleInput,
        { status: boolean; message?: string | null }
      >(
        resolvedConfig,
        { endpoint: "/change-email", method: "POST" },
        input,
        options
      ),
    changePassword: (
      input: AthenaChangePasswordRequest & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions
    ) =>
      executePostWithCompatibleInput<
        AthenaChangePasswordRequest & AthenaAuthFetchCompatibleInput,
        { token?: string | null; user: AthenaAuthUser }
      >(
        resolvedConfig,
        { endpoint: "/change-password", method: "POST" },
        input,
        options
      ),
    clearOtherSessions: revokeOtherSessions,
    clearSession: revokeSession,
    clearSessions: revokeSessions,
    deleteUser,
    deleteUserCallback,
    forgetPassword: (
      input: AthenaForgetPasswordRequest & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions
    ) =>
      executePostWithCompatibleInput<
        AthenaForgetPasswordRequest & AthenaAuthFetchCompatibleInput,
        AthenaAuthStatusResponse
      >(
        resolvedConfig,
        { endpoint: "/forget-password", method: "POST" },
        input,
        options
      ),
    getAccessToken: (
      input: AthenaOAuthAccountTokenRequest & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions
    ) =>
      executePostWithCompatibleInput<
        AthenaOAuthAccountTokenRequest & AthenaAuthFetchCompatibleInput,
        AthenaOAuthTokenBundle
      >(
        resolvedConfig,
        { endpoint: "/get-access-token", method: "POST" },
        input,
        options
      ),
    getToken: (
      input?: AthenaAuthGetTokenRequest & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions
    ) =>
      executePostWithCompatibleInput<
        AthenaAuthGetTokenRequest & AthenaAuthFetchCompatibleInput,
        AthenaAuthToken
      >(
        resolvedConfig,
        { endpoint: "/token", method: "POST" },
        input ?? ({} as AthenaAuthGetTokenRequest & AthenaAuthFetchCompatibleInput),
        options
      ),
    tokenProvider: (options) =>
      createAthenaAuthTokenProvider(
        (input, callOptions) =>
          executePostWithCompatibleInput<
            AthenaAuthGetTokenRequest & AthenaAuthFetchCompatibleInput,
            AthenaAuthToken
          >(
            resolvedConfig,
            { endpoint: "/token", method: "POST" },
            input,
            callOptions
          ),
        options
      ),
    getSession,
        getUser,
    linkSocial: (
      input: AthenaLinkSocialRequest & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions
    ) =>
      executePostWithCompatibleInput<
        AthenaLinkSocialRequest & AthenaAuthFetchCompatibleInput,
        AthenaAuthSocialRedirectResponse
      >(
        resolvedConfig,
        { endpoint: "/link-social", method: "POST" },
        input,
        options
      ),
    listAccounts: (
      input?: AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions
    ) =>
      executeGetWithCompatibleInput<AthenaAuthLinkedAccount[]>(
        resolvedConfig,
        { endpoint: "/list-accounts", method: "GET" },
        input,
        options
      ),
    listSessions: (
      input?: AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions
    ) =>
      executeGetWithCompatibleInput<AthenaAuthSession[]>(
        resolvedConfig,
        { endpoint: "/list-sessions", method: "GET" },
        input,
        options
      ),
    logout: signOut,
    organization,
    refreshToken: (
      input: AthenaOAuthAccountTokenRequest & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions
    ) =>
      executePostWithCompatibleInput<
        AthenaOAuthAccountTokenRequest & AthenaAuthFetchCompatibleInput,
        AthenaOAuthTokenBundle
      >(
        resolvedConfig,
        { endpoint: "/refresh-token", method: "POST" },
        input,
        options
      ),
    request,
    requireSession,
    resetPassword: (
      input: AthenaResetPasswordRequest & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions
    ) =>
      executePostWithCompatibleInput<
        AthenaResetPasswordRequest & AthenaAuthFetchCompatibleInput,
        AthenaAuthStatusResponse
      >(
        resolvedConfig,
        { endpoint: "/reset-password", method: "POST" },
        input,
        options
      ),
    resolveResetPasswordToken,
    revokeOtherSessions,
    revokeSession,
    revokeSessions,
    sendVerificationEmail: (
      input: AthenaSendVerificationEmailRequest &
        AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions
    ) =>
      executePostWithCompatibleInput<
        AthenaSendVerificationEmailRequest & AthenaAuthFetchCompatibleInput,
        AthenaAuthStatusResponse
      >(
        resolvedConfig,
        { endpoint: "/send-verification-email", method: "POST" },
        input,
        options
      ),
    signIn: {
      email: (
        input: AthenaEmailSignInRequest & AthenaAuthFetchCompatibleInput,
        options?: AthenaAuthCallOptions
      ) =>
        executePostWithCompatibleInput<
          AthenaEmailSignInRequest & AthenaAuthFetchCompatibleInput,
          AthenaAuthSignInResponse
        >(
          resolvedConfig,
          { endpoint: "/sign-in/email", method: "POST" },
          input,
          options
        ),
      social: (
        input: AthenaSocialSignInRequest & AthenaAuthFetchCompatibleInput,
        options?: AthenaAuthCallOptions
      ) =>
        executePostWithCompatibleInput<
          AthenaSocialSignInRequest & AthenaAuthFetchCompatibleInput,
          AthenaAuthSocialRedirectResponse | AthenaAuthSignInResponse
        >(
          resolvedConfig,
          { endpoint: "/sign-in/social", method: "POST" },
          input,
          options
        ),
      username: (
        input: AthenaUsernameSignInRequest & AthenaAuthFetchCompatibleInput,
        options?: AthenaAuthCallOptions
      ) =>
        executePostWithCompatibleInput<
          AthenaUsernameSignInRequest & AthenaAuthFetchCompatibleInput,
          AthenaAuthSignInResponse
        >(
          resolvedConfig,
          { endpoint: "/sign-in/username", method: "POST" },
          input,
          options
        ),
    },
    signOut,
    signUp: {
      email: (
        input: AthenaEmailSignUpRequest & AthenaAuthFetchCompatibleInput,
        options?: AthenaAuthCallOptions
      ) =>
        executePostWithCompatibleInput<
          AthenaEmailSignUpRequest & AthenaAuthFetchCompatibleInput,
          AthenaAuthSignInResponse
        >(
          resolvedConfig,
          { endpoint: "/sign-up/email", method: "POST" },
          input,
          options
        ),
    },
    unlinkAccount: (
      input: AthenaUnlinkAccountRequest & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions
    ) =>
      executePostWithCompatibleInput<
        AthenaUnlinkAccountRequest & AthenaAuthFetchCompatibleInput,
        AthenaAuthStatusResponse
      >(
        resolvedConfig,
        { endpoint: "/unlink-account", method: "POST" },
        input,
        options
      ),
    updateUser: (
      input: AthenaUpdateUserRequest & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions
    ) =>
      executePostWithCompatibleInput<
        AthenaUpdateUserRequest & AthenaAuthFetchCompatibleInput,
        AthenaAuthStatusResponse
      >(
        resolvedConfig,
        { endpoint: "/update-user", method: "POST" },
        input,
        options
      ),
    verifyEmail: (
      input: AthenaVerifyEmailRequest & AthenaAuthFetchCompatibleInput,
      options?: AthenaAuthCallOptions
    ) => {
      const { payload, fetchOptions } = extractFetchOptions(input);
      const mergedOptions = mergeCallOptions(fetchOptions, options);
      const query = payload as AthenaVerifyEmailRequest | undefined;
      return callAuthEndpoint<{ user: AthenaAuthUser; status: boolean }>(
        resolvedConfig,
        { endpoint: "/verify-email", method: "GET" },
        undefined,
        query
          ? {
              callbackURL: query.callbackURL,
              token: query.token,
            }
          : undefined,
        mergedOptions
      );
    },
  };
}
