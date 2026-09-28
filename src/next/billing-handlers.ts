import {
  isAthenaBillingAuthorizationError,
  isAthenaBillingCapabilityError,
  AthenaBillingError,
  isAthenaBillingProviderError,
  isAthenaBillingProviderRequestError,
} from "../billing/errors.ts";
import type { BillingRuntimeDispatchOperation } from "../billing/runtime/dispatch.ts";
import { peekEmbeddedBillingRuntimeSurfaces } from "../billing/runtime/local/process-ownership.ts";
import { isAthenaBillingSubjectError } from "../billing/subject/errors.ts";
import type { AthenaRuntimeDiscoveryDocument } from "../gateway/discovery-types.ts";
import {
  type AthenaPrincipalResolutionFailure,
  normalizeAthenaRuntimeAuth,
  resolveAthenaRuntimePrincipal,
} from "../runtime/authority/index.ts";
import {
  getAthenaClientInternals,
  requireAthenaRootClientInternals,
} from "../runtime/client-internals.ts";
import {
  createAthenaSessionAuthFromStores,
  readAuthRightsProjection,
} from "../runtime/data/athena-session.ts";
import { isAllowedRequestOrigin } from "../runtime/data/origin.ts";
import type { AthenaRuntimeAuthConfig } from "../runtime/data/principal.ts";
import {
  extraAllowedAppHttpOrigins,
  requestCarriesSessionCookie,
  shouldEnforceCookieAwareRequestOrigin,
} from "../runtime/data/request-origin-policy.ts";
import type {
  AthenaRuntimeHttpSecurity,
  AthenaRuntimeSecurityMode,
} from "../runtime/data/types.ts";
import {
  isAthenaHttpBodyLimitError,
  parseAthenaIncomingHttpRequest,
} from "../runtime/transport/http/incoming.ts";

export interface AthenaBillingHandlers {
  GET: (request: Request) => Promise<Response>;
  POST: (request: Request) => Promise<Response>;
}

export interface CreateAthenaBillingHandlersOptions {
  auth?: AthenaRuntimeAuthConfig;
  client: object;
  discoveryDocument: AthenaRuntimeDiscoveryDocument;
  security?: {
    http?: AthenaRuntimeHttpSecurity;
    mode?: AthenaRuntimeSecurityMode;
  };
}

const BILLING_OPERATIONS = new Set<BillingRuntimeDispatchOperation>([
  "payments.list",
  "payments.create",
  "payments.get",
  "payments.cancel",
  "customers.list",
  "customers.create",
  "customers.get",
  "customers.update",
  "customers.delete",
  "refunds.list",
  "refunds.create",
  "refunds.get",
  "refunds.cancel",
  "paymentLinks.list",
  "paymentLinks.create",
  "paymentLinks.get",
  "paymentLinks.update",
  "paymentLinks.delete",
  "subscriptions.list",
  "subscriptions.create",
  "subscriptions.get",
  "subscriptions.update",
  "subscriptions.cancel",
  "invoices.list",
  "invoices.get",
  "webhooks.list",
  "webhooks.create",
  "webhooks.get",
  "webhooks.update",
  "webhooks.delete",
  "webhooks.test",
  "products.list",
  "prices.list",
  "relations.list",
  "checkout.create",
  "getCapabilities",
  "self.invoices.list",
  "self.invoices.get",
  "self.payments.list",
  "self.payments.get",
  "self.subscription.get",
  "self.subscription.cancel",
  "self.subscription.enroll",
  "self.subscription.change",
  "self.checkout.create",
  "self.checkout.resume",
  "self.customer.get",
  "self.entitlements",
  "admin.connections.materialize",
  "admin.bootstrap.retry",
  "admin.reconciliation.run",
  "admin.reconciliation.retry",
  "admin.webhooks.reconcile",
  "admin.webhooks.verify",
  "admin.webhooks.status",
  "admin.ingestion.health",
  "admin.conflicts.resolve",
  "admin.conflicts.list",
]);

function extraAllowedBillingOrigins(
  clientConfig: { app?: { url?: string | null } },
  security?: CreateAthenaBillingHandlersOptions["security"]
): string[] {
  return extraAllowedAppHttpOrigins(clientConfig, security);
}

function billingRequestCarriesSessionCookie(request: Request): boolean {
  return requestCarriesSessionCookie(request);
}

/**
 * Cookie-session billing always Origin-checks, even when `security.mode` is
 * `trusted`. Session cookies are issued SameSite=Lax (`createSessionCookieHeader`);
 * Origin is still required so a trusted principal overlay cannot skip CSRF for
 * browser cookie POSTs. Bearer / process callers with no session cookie may skip
 * Origin only when trusted is explicit.
 */
function shouldEnforceBillingRequestOrigin(
  request: Request,
  explicitTrusted: boolean
): boolean {
  if (billingRequestCarriesSessionCookie(request)) {
    return true;
  }
  return shouldEnforceCookieAwareRequestOrigin(request, explicitTrusted);
}

export function createAthenaBillingHandlers(
  options: CreateAthenaBillingHandlersOptions
): AthenaBillingHandlers {
  const internals = requireAthenaRootClientInternals(
    options.client,
    "createAthenaBillingHandlers({ client })"
  );

  const discovery: AthenaRuntimeDiscoveryDocument = {
    ...options.discoveryDocument,
    endpoints: {
      data: options.discoveryDocument.endpoints?.data ?? "/api/athena",
      ...(options.discoveryDocument.endpoints?.storage
        ? { storage: options.discoveryDocument.endpoints.storage }
        : {}),
      ...(options.discoveryDocument.endpoints?.billing
        ? { billing: options.discoveryDocument.endpoints.billing }
        : {}),
      ...(options.discoveryDocument.endpoints?.auth === undefined
        ? {}
        : { auth: options.discoveryDocument.endpoints.auth }),
    },
  };

  const securityMode: AthenaRuntimeSecurityMode =
    options.security?.mode ??
    (options.auth !== undefined || internals.getAuthStores
      ? "authenticated"
      : "trusted");
  let auth: AthenaRuntimeAuthConfig | undefined = options.auth;
  if (auth === undefined && internals.getAuthStores) {
    auth = createAthenaSessionAuthFromStores({
      authorization: readAuthRightsProjection(internals.config),
      getStores: internals.getAuthStores,
    });
  }
  const authMaterial = normalizeAthenaRuntimeAuth(auth, securityMode);

  return {
    async GET() {
      return Response.json(discovery);
    },
    async POST(request: Request) {
      // Origin/CSRF: omitted `security.mode` still checks Origin even if
      // principal resolution falls back to trusted (no Auth resolver).
      // Session-cookie POSTs always check Origin, including explicit trusted.
      if (
        shouldEnforceBillingRequestOrigin(
          request,
          options.security?.mode === "trusted"
        ) &&
        !isAllowedRequestOrigin(
          request,
          extraAllowedBillingOrigins(internals.config, options.security)
        )
      ) {
        return jsonError(
          {
            code: "ATHENA_BILLING_AUTHORIZATION_DENIED",
            message: "cross-origin billing request denied",
          },
          403
        );
      }

      const live = getAthenaClientInternals(options.client);
      const surfaces = peekEmbeddedBillingRuntimeSurfaces(
        live?.billingRuntimeOwnerKey ?? internals.billingRuntimeOwnerKey
      );
      const runtime =
        surfaces?.dispatch ?? live?.billingRuntime ?? internals.billingRuntime;
      if (!runtime) {
        return jsonError(
          {
            code: "ATHENA_BILLING_OPERATION_UNAVAILABLE",
            message: "billing runtime is not configured",
          },
          503
        );
      }

      let body: unknown;
      try {
        const incoming = await parseAthenaIncomingHttpRequest(request);
        if (incoming.body.byteLength === 0) {
          body = {};
        } else {
          body = JSON.parse(new TextDecoder().decode(incoming.body));
        }
      } catch (error) {
        if (isAthenaHttpBodyLimitError(error)) {
          return jsonError(
            {
              code: error.code,
              message: error.message,
            },
            error.status
          );
        }
        return jsonError(
          {
            code: "ATHENA_BILLING_INVALID_REQUEST",
            message: "invalid JSON body",
          },
          400
        );
      }

      const envelope = asRecord(body);
      const operation = envelope.operation;

      if (
        typeof operation !== "string" ||
        !BILLING_OPERATIONS.has(operation as BillingRuntimeDispatchOperation)
      ) {
        return jsonError(
          {
            code: "ATHENA_BILLING_INVALID_REQUEST",
            message: "operation is required",
          },
          400
        );
      }

      const headers: Record<string, string> = {};
      request.headers.forEach((value, name) => {
        headers[name] = value;
      });
      const resolution = await resolveAthenaRuntimePrincipal(
        authMaterial,
        securityMode,
        { headers, request }
      );
      if (!resolution.ok) {
        return jsonError(
          principalFailure(resolution.failure),
          resolution.failure.status
        );
      }

      if (resolution.resolved.principal.authenticated !== true) {
        return jsonError(
          {
            code: "ATHENA_BILLING_UNAUTHENTICATED",
            message: "Authentication is required for billing.",
          },
          401
        );
      }

      try {
        const data = await runtime.execute(
          operation as BillingRuntimeDispatchOperation,
          envelope.payload,
          resolution.resolved.principal
        );
        return Response.json({ data, ok: true, status: 200 });
      } catch (error) {
        return encodeBillingError(error);
      }
    },
  };
}

function principalFailure(failure: AthenaPrincipalResolutionFailure): {
  code: string;
  message: string;
} {
  if (failure.code === "ATHENA_AUTH_ORG_NOT_ALLOWED") {
    return {
      code: "ATHENA_BILLING_AUTHORIZATION_DENIED",
      message: failure.message,
    };
  }
  return {
    code: "ATHENA_BILLING_UNAUTHENTICATED",
    message: failure.message,
  };
}

function encodeBillingError(error: unknown): Response {
  if (
    error instanceof AthenaBillingError &&
    error.code === "ATHENA_BILLING_INVALID_REQUEST"
  ) {
    return jsonError(
      {
        code: error.code,
        message: error.message,
      },
      error.status
    );
  }
  if (isAthenaBillingAuthorizationError(error)) {
    return jsonError(
      {
        code: error.code,
        errorNumber: error.errorNumber,
        message: error.message,
        missing: error.missing,
        operation: error.operation,
      },
      error.status
    );
  }
  if (isAthenaBillingCapabilityError(error)) {
    return jsonError(
      {
        code: error.code,
        message: error.message,
        operation: error.operation,
        reason: error.reason,
      },
      error.reason === "unsupported_operation" ? 400 : 503
    );
  }
  if (isAthenaBillingProviderRequestError(error)) {
    const status =
      error.status ??
      (error.kind === "not_found"
        ? 404
        : error.kind === "signature_invalid"
          ? 400
          : 500);
    return jsonError(
      {
        code:
          error.kind === "signature_invalid"
            ? "ATHENA_BILLING_WEBHOOK_SIGNATURE_INVALID"
            : "ATHENA_BILLING_PROVIDER_REQUEST",
        kind: error.kind,
        message: "Billing provider request failed.",
        retry: error.retry,
      },
      status
    );
  }
  if (isAthenaBillingSubjectError(error)) {
    const status =
      typeof error.status === "number"
        ? error.status
        : error.code === "ATHENA_BILLING_NOT_FOUND"
          ? 404
          : 400;
    return jsonError(
      {
        code: error.code,
        conflict: error.conflict,
        message: error.message,
      },
      status
    );
  }
  if (isAthenaBillingProviderError(error)) {
    return jsonError(
      {
        code: error.code,
        message: error.message,
      },
      error.code === "ATHENA_BILLING_PROVIDER_NOT_CONFIGURED" ? 400 : 500
    );
  }
  const message = error instanceof Error ? error.message : String(error);
  const safetyCode = /^(ATHENA_BILLING_[A-Z0-9_]+)/.exec(message)?.[0];
  if (safetyCode) {
    return jsonError(
      {
        code: safetyCode,
        message: safetyCode,
      },
      400
    );
  }
  console.error("[athena.billing] unhandled billing HTTP error", error);
  return jsonError(
    {
      code: "ATHENA_BILLING_INTERNAL",
      message: "Billing request failed.",
    },
    500
  );
}

function jsonError(
  error: {
    code: string;
    conflict?: string;
    errorNumber?: number;
    kind?: string;
    message: string;
    missing?: readonly string[];
    operation?: string;
    provider?: string;
    reason?: string;
    retry?: string;
  },
  status: number
): Response {
  return Response.json({ error, ok: false, status }, { status });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}
