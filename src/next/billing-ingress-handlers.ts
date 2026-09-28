import { createBillingSqlExecutorFromManager } from "../billing/import/database.ts";
import { inspectBillingWebhookIngressBinding } from "../billing/import/postgres.ts";
import {
  BILLING_INGRESS_ADMISSION_CODES,
  type BillingIngressAdmission,
  type BillingIngressAdmissionPolicy,
  createBillingIngressAdmission,
} from "../billing/ingestion/admission.ts";
import { billingWebhookIngressObservabilityFromInternals } from "../billing/ingestion/observability/from-internals.ts";
import { recordBillingWebhookIngressQuietly } from "../billing/ingestion/observability/health.ts";
import { createBillingRejectedIngressEvidence } from "../billing/ingestion/observability/rejection-evidence.ts";
import {
  billingWebhookRegistrationKind,
  persistableWebhookRejectionStage,
  publicBillingRejectionCode,
} from "../billing/ingestion/observability/stages.ts";
import {
  BILLING_MOLLIE_CLASSIC_WEBHOOK_PATH,
  BILLING_MOLLIE_EVENTS_WEBHOOK_PATH,
  billingWebhookIngressBindingToken,
  billingWebhookPathKind,
} from "../billing/ingestion/urls.ts";
import { resolveBillingEnvironment } from "../billing/runtime/environment.ts";
import { peekEmbeddedBillingRuntimeSurfaces } from "../billing/runtime/local/process-ownership.ts";
import {
  classifyMollieWebhookBody,
  expectedMollieWebhookEnvelope,
} from "../billing/runtime/local/providers/mollie/parse-webhook.ts";
import { MOLLIE_WEBHOOK_MAX_BODY_BYTES } from "../billing/runtime/local/providers/mollie/verify-webhook.ts";
import {
  getAthenaClientInternals,
  requireAthenaRootClientInternals,
} from "../runtime/client-internals.ts";
import { compileHttpWebhookIngress } from "../runtime/ingress/compiler/http.ts";
import {
  ATHENA_EVENT_INGRESS_FAILED,
  ATHENA_EVENT_INGRESS_PERSISTENCE_REQUIRED,
  ATHENA_EVENT_INGRESS_UNAVAILABLE,
  ATHENA_INGRESS_MOLLIE_SIGNATURE_INVALID,
  AthenaEventIngressError,
  eventIngressHttpStatus,
  isAthenaEventIngressError,
} from "../runtime/ingress/errors.ts";
import { wrapIngressProcessingError } from "../runtime/ingress/failure.ts";
import type { EventIngressRuntime } from "../runtime/ingress/runtime.ts";
import { isAthenaHttpBodyLimitError } from "../runtime/transport/http/incoming.ts";

export const DEFAULT_ATHENA_NEXT_BILLING_WEBHOOK_ENDPOINT =
  "/api/athena/billing/webhook";
export const DEFAULT_ATHENA_NEXT_BILLING_MOLLIE_CLASSIC_WEBHOOK_ENDPOINT =
  BILLING_MOLLIE_CLASSIC_WEBHOOK_PATH;
export const DEFAULT_ATHENA_NEXT_BILLING_MOLLIE_EVENTS_WEBHOOK_ENDPOINT =
  BILLING_MOLLIE_EVENTS_WEBHOOK_PATH;

export interface AthenaBillingIngressHandlers {
  readonly admission?: BillingIngressAdmission;
  POST: (request: Request) => Promise<Response>;
}

export interface CreateAthenaBillingIngressHandlersOptions {
  admission?: BillingIngressAdmissionPolicy;
  client: object;
  connectionId?: string;
  diagnosticsKey?: string | Uint8Array;
}

function configuredAdmissionPolicy(
  client: object,
): BillingIngressAdmissionPolicy | undefined {
  const internals = getAthenaClientInternals(client);
  const config = internals?.config as
    | {
      billing?: {
        ingestion?: {
          webhooks?: {
            admission?: BillingIngressAdmissionPolicy;
          };
        };
      };
    }
    | undefined;
  return config?.billing?.ingestion?.webhooks?.admission;
}

function requestIp(request: Request, trustProxy: boolean): string | undefined {
  if (!trustProxy) {
    return;
  }
  const forwarded = request.headers.get("x-forwarded-for");
  return (
    request.headers.get("cf-connecting-ip") ??
    (forwarded ? forwarded.split(",")[0]?.trim() : undefined) ??
    request.headers.get("x-real-ip") ??
    undefined
  );
}

function declaredBodyBytes(request: Request): number | undefined {
  const value = request.headers.get("content-length");
  if (value == null || value.trim() === "") {
    return;
  }
  const length = Number(value);
  return Number.isInteger(length) && length >= 0 ? length : undefined;
}

function admissionRejectionResponse(
  reason: "body_too_large" | "concurrent_limit" | "rate_limited",
): Response {
  const status = reason === "body_too_large" ? 413 : 429;
  const code = BILLING_INGRESS_ADMISSION_CODES[reason];
  return new Response(
    JSON.stringify({
      code,
      message:
        reason === "body_too_large"
          ? "Webhook request body exceeds the configured size limit."
          : "Webhook ingress admission limit exceeded.",
    }),
    {
      headers: { "content-type": "application/json" },
      status,
    },
  );
}

function webhookBindingRejectionResponse(
  reason: "binding_missing" | "binding_unknown" | "environment_superseded",
): Response {
  if (process.env.NODE_ENV === "production") {
    return new Response(null, { status: 404 });
  }
  if (reason === "environment_superseded") {
    return new Response(
      JSON.stringify({
        code: "ATHENA_BILLING_WEBHOOK_BINDING_ENVIRONMENT_SUPERSEDED",
        message:
          "The Billing webhook binding belongs to a superseded connection environment.",
        reason,
      }),
      {
        headers: { "content-type": "application/json" },
        status: 404,
      },
    );
  }
  const missing = reason === "binding_missing";
  return new Response(
    JSON.stringify({
      code: missing
        ? "ATHENA_BILLING_WEBHOOK_BINDING_MISSING"
        : "ATHENA_BILLING_WEBHOOK_BINDING_UNKNOWN",
      message: missing
        ? "A connection binding token is required for this Billing webhook endpoint."
        : "The Billing webhook connection binding could not be resolved.",
      reason,
    }),
    {
      headers: { "content-type": "application/json" },
      status: 404,
    },
  );
}

type IngressBindingResolution =
  | { kind: "unbound" }
  | { kind: "resolved"; connectionId: string }
  | { kind: "unknown" }
  | {
    kind: "environment_superseded";
    connectionEnvironment: "live" | "test";
    processEnvironment: "live" | "test";
  };

function billingProcessEnvironment(client: object): "live" | "test" {
  const internals = getAthenaClientInternals(client);
  const billing = internals?.config as
    | { billing?: { testMode?: boolean } }
    | undefined;
  return resolveBillingEnvironment({
    testMode: billing?.billing?.testMode,
  }).testMode
    ? "test"
    : "live";
}

function configuredBillingDiagnosticsKey(
  client: object
): string | undefined {
  const internals = getAthenaClientInternals(client);
  const webhooks = (
    internals?.config as
      | {
          billing?: {
            ingestion?: {
              webhooks?: {
                providers?: {
                  mollie?: {
                    nextGen?: {
                      previousSigningSecrets?: readonly unknown[];
                      signingSecret?: unknown;
                    };
                  };
                };
                secretMasterKey?: unknown;
              };
            };
          };
        }
      | undefined
  )?.billing?.ingestion?.webhooks;
  if (webhooks == null || typeof webhooks !== "object") {
    return;
  }
  const nextGen = webhooks.providers?.mollie?.nextGen;
  const candidates = [
    webhooks.secretMasterKey,
    nextGen?.signingSecret,
    ...(nextGen?.previousSigningSecrets ?? []),
  ];
  return candidates.find(
    (candidate): candidate is string =>
      typeof candidate === "string" && candidate.trim().length > 0
  );
}

async function resolveIngressConnectionId(input: {
  client: object;
  explicitConnectionId?: string;
  pathname: string;
}): Promise<IngressBindingResolution> {
  if (
    input.explicitConnectionId != null &&
    input.explicitConnectionId.length > 0
  ) {
    return { kind: "resolved", connectionId: input.explicitConnectionId };
  }
  const token = billingWebhookIngressBindingToken(input.pathname);
  if (token == null) {
    return { kind: "unbound" };
  }
  const internals = getAthenaClientInternals(input.client);
  const manager = internals?.postgresRuntime
    ? await internals.postgresRuntime.getPoolManager()
    : undefined;
  if (!manager) {
    throw new AthenaEventIngressError({
      code: ATHENA_EVENT_INGRESS_PERSISTENCE_REQUIRED,
      domain: "billing",
      message:
        "Billing webhook ingress bindings require PostgreSQL so the connection can be resolved.",
      retryable: true,
    });
  }
  const inspected = await inspectBillingWebhookIngressBinding(
    createBillingSqlExecutorFromManager(manager),
    {
      processEnvironment: billingProcessEnvironment(input.client),
      token,
    },
  );
  if (inspected.kind === "resolved") {
    return { kind: "resolved", connectionId: inspected.connectionId };
  }
  if (inspected.kind === "environment_superseded") {
    console.error("[athena.billing] webhook binding environment superseded", {
      code: "ATHENA_BILLING_WEBHOOK_BINDING_ENVIRONMENT_SUPERSEDED",
      connectionEnvironment: inspected.connectionEnvironment,
      connectionId: inspected.connectionId,
      processEnvironment: inspected.processEnvironment,
      status: inspected.status,
    });
    return {
      kind: "environment_superseded",
      connectionEnvironment: inspected.connectionEnvironment,
      processEnvironment: inspected.processEnvironment,
    };
  }
  return { kind: "unknown" };
}

export function createAthenaBillingIngressHandlers(
  options: CreateAthenaBillingIngressHandlersOptions,
): AthenaBillingIngressHandlers {
  requireAthenaRootClientInternals(
    options.client,
    "createAthenaBillingIngressHandlers({ client })",
  );
  const admission: BillingIngressAdmission = createBillingIngressAdmission({
    ...(configuredAdmissionPolicy(options.client) ?? {}),
    ...(options.admission ?? {}),
  });

  return {
    admission,
    async POST(request: Request): Promise<Response> {
      const internals = getAthenaClientInternals(options.client);
      const surfaces = peekEmbeddedBillingRuntimeSurfaces(
        internals?.billingRuntimeOwnerKey
      );
      const observability =
        billingWebhookIngressObservabilityFromInternals(internals);
      const pathname = new URL(request.url).pathname;
      const pathKind = billingWebhookPathKind(pathname);
      const operation =
        pathKind === "events"
          ? "webhook.mollie.events"
          : "webhook.mollie.classic";
      const kind = billingWebhookRegistrationKind(operation);
      const runtime = (surfaces?.eventIngress ??
        internals?.eventIngressRuntime) as EventIngressRuntime | undefined;
      if (!runtime) {
        const unavailable = new AthenaEventIngressError({
          code: ATHENA_EVENT_INGRESS_UNAVAILABLE,
          message: "EventIngressRuntime is not attached.",
          retryable: true,
        });
        await recordBillingWebhookIngressQuietly(
          observability,
          async (store) => {
            await store.recordRejected({
              code: unavailable.code,
              kind,
              stage: persistableWebhookRejectionStage(),
              ...(options.connectionId
                ? { connectionId: options.connectionId }
                : {}),
            });
          },
        );
        return new Response(
          JSON.stringify({
            code: unavailable.code,
            message: unavailable.message,
          }),
          { headers: { "content-type": "application/json" }, status: 503 },
        );
      }
      let compiledBody: Uint8Array | undefined;
      let compiledConnectionId: string | undefined;
      let admissionDecision:
        | ReturnType<BillingIngressAdmission["admit"]>
        | undefined;
      try {
        if (pathKind === "compat" && process.env.NODE_ENV === "production") {
          return new Response(null, { status: 404 });
        }
        const token = billingWebhookIngressBindingToken(pathname);
        if (
          (pathKind === "classic" || pathKind === "events") &&
          token == null &&
          (options.connectionId == null || options.connectionId.length === 0)
        ) {
          return webhookBindingRejectionResponse("binding_missing");
        }
        if (
          process.env.NODE_ENV === "production" &&
          options.connectionId != null &&
          options.connectionId.length > 0 &&
          token == null
        ) {
          return new Response(null, { status: 404 });
        }
        admissionDecision = admission.admit({
          bodyBytes: declaredBodyBytes(request),
          connectionId: options.connectionId,
          ip: requestIp(request, admission.policy().trustProxy),
          provider: "mollie",
          ...(token ? { token } : {}),
        });
        if (!admissionDecision.accepted) {
          if (admissionDecision.reason == null) {
            throw new Error(
              "Billing ingress admission rejected without a reason.",
            );
          }
          if (admissionDecision.reason === "invalid_auth") {
            return new Response(null, { status: 401 });
          }
          return admissionRejectionResponse(admissionDecision.reason);
        }
        const binding = await resolveIngressConnectionId({
          client: options.client,
          explicitConnectionId: options.connectionId,
          pathname,
        });
        if (pathKind === "classic" || pathKind === "events") {
          if (binding.kind === "environment_superseded") {
            return webhookBindingRejectionResponse("environment_superseded");
          }
          if (binding.kind !== "resolved") {
            return webhookBindingRejectionResponse("binding_unknown");
          }
        }
        const connectionId =
          binding.kind === "resolved" ? binding.connectionId : undefined;
        if (
          token != null &&
          options.connectionId == null &&
          connectionId != null &&
          connectionId.trim().length > 0
        ) {
          const initialAdmission = admissionDecision;
          if (!initialAdmission) {
            throw new Error("Billing ingress admission decision is missing.");
          }
          admissionDecision = initialAdmission.rekey({
            connectionId,
            provider: "mollie",
          });
          if (!admissionDecision.accepted) {
            if (admissionDecision.reason == null) {
              throw new Error(
                "Billing ingress rekey rejected without a reason.",
              );
            }
            if (admissionDecision.reason === "invalid_auth") {
              return new Response(null, { status: 401 });
            }
            return admissionRejectionResponse(admissionDecision.reason);
          }
        }
        const ingress = await compileHttpWebhookIngress({
          domain: "billing",
          operation,
          request,
          ...(connectionId ? { connectionId } : {}),
          maxBodyBytes: Math.min(
            MOLLIE_WEBHOOK_MAX_BODY_BYTES,
            admission.policy().maxBodyBytes,
          ),
        });
        compiledBody = ingress.body;
        compiledConnectionId = ingress.connectionId ?? options.connectionId;
        await recordBillingWebhookIngressQuietly(
          observability,
          async (store) => {
            const connectionId = ingress.connectionId ?? options.connectionId;
            await store.recordStage({
              ingressId: ingress.id,
              kind,
              occurredAt: new Date(),
              operation,
              provider: "mollie",
              stage: "received",
              ...(connectionId ? { connectionId } : {}),
              ...(ingress.correlationId
                ? { correlationId: ingress.correlationId }
                : {}),
              ...(ingress.traceId ? { traceId: ingress.traceId } : {}),
            });
            if (connectionId) {
              await store.recordDelivery({
                connectionId,
                event: "received",
                kind,
              });
            }
          },
        );
        const result = await runtime.ingest(ingress);
        const reconciliation = result.reconciliation ?? "skipped";
        if (result.duplicate) {
          admission.recordDuplicate(compiledConnectionId);
        }
        return new Response(
          JSON.stringify({
            duplicate: result.duplicate,
            ok: true,
            reconciliation,
          }),
          {
            headers: { "content-type": "application/json" },
            status: result.duplicate ? 200 : 202,
          },
        );
      } catch (caught) {
        const error = wrapIngressProcessingError({
          ...(compiledConnectionId
            ? { connectionId: compiledConnectionId }
            : {}),
          error: caught,
          stage: "unknown",
        });
        if (
          isAthenaEventIngressError(error) &&
          error.code === ATHENA_INGRESS_MOLLIE_SIGNATURE_INVALID
        ) {
          admission.recordInvalidAuth(compiledConnectionId);
        }
        if (isAthenaHttpBodyLimitError(caught)) {
          return new Response(
            JSON.stringify({
              code: caught.code,
              message: caught.message,
            }),
            {
              headers: { "content-type": "application/json" },
              status: caught.status,
            },
          );
        }
        const status = eventIngressHttpStatus(error);
        const code = isAthenaEventIngressError(error)
          ? error.code
          : ATHENA_EVENT_INGRESS_FAILED;
        const contentType = request.headers.get("content-type") ?? undefined;
        const envelope =
          isAthenaEventIngressError(error) && error.diagnostics
            ? {
              bodyBytes: error.diagnostics.bodyBytes,
              bodyKind: error.diagnostics.bodyKind,
              contentType: error.diagnostics.contentType ?? contentType,
            }
            : classifyMollieWebhookBody(
              compiledBody ?? new Uint8Array(),
              contentType,
            );
        const expectedEnvelope = expectedMollieWebhookEnvelope(operation);
        const evidence = createBillingRejectedIngressEvidence({
          body: compiledBody ?? new Uint8Array(),
          bodyKind: envelope.bodyKind,
          contentType: envelope.contentType ?? contentType,
          key:
            options.diagnosticsKey ??
            configuredBillingDiagnosticsKey(options.client),
        });
        console.error("[athena.billing] webhook ingress rejected", {
          code,
          ...evidence,
          expectedEnvelope,
          ...(isAthenaEventIngressError(error)
            ? {
              connectionId: error.diagnostics?.connectionId,
              operation: error.diagnostics?.operation,
              provider: error.provider,
              providerStatus: error.diagnostics?.providerStatus,
              retryable: error.diagnostics?.retryable ?? error.retryable,
              stage: error.diagnostics?.stage,
            }
            : {}),
        });
        await recordBillingWebhookIngressQuietly(
          observability,
          async (store) => {
            await store.recordRejected({
              code: publicBillingRejectionCode(error),
              evidence: {
                payload: evidence,
                expectedEnvelope: { ...expectedEnvelope },
              },
              kind,
              metadata: {
                bodyBytes: envelope.bodyBytes,
                bodyKind: envelope.bodyKind,
                ...(envelope.contentType
                  ? { contentType: envelope.contentType }
                  : {}),
              },
              stage: persistableWebhookRejectionStage(),
              ...(compiledConnectionId
                ? { connectionId: compiledConnectionId }
                : options.connectionId
                  ? { connectionId: options.connectionId }
                  : {}),
            });
          },
        );
        return new Response(
          JSON.stringify({
            code,
            message: isAthenaEventIngressError(error)
              ? error.code
              : "Webhook ingest failed.",
          }),
          {
            headers: { "content-type": "application/json" },
            status,
          },
        );
      } finally {
        admissionDecision?.release();
      }
    },
  };
}
