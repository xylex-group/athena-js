import type { AthenaGatewayResponse } from "../../../gateway/types.ts";
import { applyAthenaPolicyDecision as applyPolicyRewrite } from "../../../policy/apply.ts";
import { decideAthenaPolicy as decidePolicy } from "../../../policy/decide.ts";
import { actionFromRuntimeOperation as policyActionFromOperation } from "../../../policy/decision.ts";
import { readRuntimeErrorCode, runtimeDeniedResponse } from "../errors.ts";
import {
  emitExecutionEvent as emitRuntimeExecutionEvent,
  ENDPOINT as GATEWAY_ENDPOINT,
  enforceHttpLimits as runFinalHttpLimits,
  enforceModels as runFinalModelValidation,
  dispatchAthenaTransport as sendAuthorizedTransport,
} from "../gates.ts";
import * as payloadLimitInspect from "../limits.ts";
import { resourceNameFromPayload } from "../model-registry.ts";
import {
  normalizeDataTransportFailure,
  tableNameFromAuthorizedPayload,
} from "../normalize-transport-failure.ts";
import { anonymousAthenaPrincipal } from "../principal.ts";
import type {
  AthenaRuntimeRequest,
  AthenaRuntimeRequestContext,
  AthenaServerRuntime,
} from "../types.ts";
import { sanitizeDataLifecyclePrincipal } from "./context.ts";
import { createDataNucleusEnvelope } from "./envelope.ts";
import * as dataNucleusHooks from "./hooks.ts";
import { authorizeDataNucleusMutation } from "./authorize.ts";
import { prepareDataMutation } from "./prepare.ts";
import { boundDataMutationResult } from "./result.ts";
import { createDataNucleusPhaseClock } from "./timing.ts";
import { resolveDataTransactionSemantics } from "./transaction.ts";
import {
  hasAuthorizedBrand,
} from "./types.ts";
import type { AthenaResolvedPrincipal } from "../principal.ts";

function canonicalizeDataPayload(payload: unknown): unknown {
  if (payload === undefined) {
    return payload;
  }
  return JSON.parse(JSON.stringify(payload));
}

function applyAthenaPolicyDecision(
  input: Parameters<typeof applyPolicyRewrite>[0]
): ReturnType<typeof applyPolicyRewrite> {
  return applyPolicyRewrite(input);
}

type PrincipalResolution = {
  resolved?: AthenaResolvedPrincipal;
};

function auditResourceMatch(
  resource: string | undefined,
  resources: readonly string[] | undefined
): boolean {
  if (!(resource && resources?.length)) {
    return false;
  }
  return resources.some(
    (item) => item === resource || resource.endsWith(`.${item}`)
  );
}

export async function executeDataNucleusMutation(
  runtime: AthenaServerRuntime,
  request: AthenaRuntimeRequest,
  context: AthenaRuntimeRequestContext | undefined,
  resolution: PrincipalResolution,
  started: number
): Promise<AthenaGatewayResponse<unknown>> {
  const envelope = createDataNucleusEnvelope(context);
  const clock = createDataNucleusPhaseClock(started);
  const transactionSemantics = resolveDataTransactionSemantics(runtime);
  const principal = sanitizeDataLifecyclePrincipal(
    resolution.resolved as Parameters<typeof sanitizeDataLifecyclePrincipal>[0]
  );
  const authorizationPrincipal =
    resolution.resolved?.principal ?? anonymousAthenaPrincipal();
  const correlation = {
    eventId: envelope.eventId,
    requestId: envelope.requestId,
    semanticOperation: request.semanticOperation,
    traceId: envelope.traceId,
    transactionSemantics,
  };
  const hookFrame = {
    envelope,
    principal,
    transactionSemantics,
    ...(runtime.modelIndex ? { modelIndex: runtime.modelIndex } : {}),
  };

  clock.mark("prepare");
  try {
    await prepareDataMutation(
      runtime.lifecycle?.data,
      request,
      runtime.modelIndex
    );
  } catch (error) {
    const failed = runtimeDeniedResponse(
      "ATHENA_RUNTIME_CONFIG_INVALID",
      error instanceof Error ? error.message : String(error),
      GATEWAY_ENDPOINT[request.operation] ?? GATEWAY_ENDPOINT.fetch,
      500
    );
    emitRuntimeExecutionEvent(
      runtime,
      request,
      context,
      resolution,
      failed,
      started,
      "error",
      { ...correlation, errorPhase: "prepare", ...clock.timings() }
    );
    throw error;
  }

  clock.mark("canonicalize");
  request.payload = canonicalizeDataPayload(request.payload);

  clock.mark("policy");
  const policyDenied = enforcePolicy(runtime, request, context);
  if (policyDenied) {
    emitRuntimeExecutionEvent(
      runtime,
      request,
      context,
      resolution,
      policyDenied,
      started,
      readRuntimeErrorCode(policyDenied),
      { ...correlation, errorPhase: "policy", ...clock.timings() }
    );
    return policyDenied;
  }

  clock.mark("canonicalize");
  request.payload = canonicalizeDataPayload(request.payload);

  clock.mark("model");
  const denied = enforceModels(runtime, request);
  if (denied) {
    emitRuntimeExecutionEvent(
      runtime,
      request,
      context,
      resolution,
      denied,
      started,
      readRuntimeErrorCode(denied),
      { ...correlation, errorPhase: "model", ...clock.timings() }
    );
    return denied;
  }

  clock.mark("limits");
  void inspectPayloadLimits(request.payload, runtime.httpProfile.limits);
  const limited = enforceHttpLimits(runtime, request);
  if (limited) {
    emitRuntimeExecutionEvent(
      runtime,
      request,
      context,
      resolution,
      limited,
      started,
      readRuntimeErrorCode(limited),
      { ...correlation, errorPhase: "limits", ...clock.timings() }
    );
    return limited;
  }

  const authorization = authorizeDataNucleusMutation({
    authorizationBindings: runtime.authorizationConfig?.bindingRegistry,
    oauthScopePolicy: runtime.oauthScopePolicy,
    policies: runtime.policyRegistry,
    principal: authorizationPrincipal,
    request,
    unmatchedResources: runtime.authorizationConfig?.unmatchedResources,
  });
  if (!authorization.ok) {
    emitRuntimeExecutionEvent(
      runtime,
      request,
      context,
      resolution,
      authorization.response,
      started,
      readRuntimeErrorCode(authorization.response),
      { ...correlation, errorPhase: "authorization", ...clock.timings() }
    );
    return authorization.response;
  }
  const authorized = authorization.authorized;
  Object.freeze(authorized);
  if (!hasAuthorizedBrand(authorized)) {
    const failed = runtimeDeniedResponse(
      "ATHENA_RUNTIME_CONFIG_INVALID",
      "Data nucleus transport requires AuthorizedDataMutation.",
      GATEWAY_ENDPOINT[request.operation] ?? GATEWAY_ENDPOINT.fetch,
      500
    );
    emitRuntimeExecutionEvent(
      runtime,
      request,
      context,
      resolution,
      failed,
      started,
      "error",
      { ...correlation, errorPhase: "execute", ...clock.timings() }
    );
    return failed;
  }
  request.payload = authorized.payload;

  clock.mark("before_hooks");
  try {
    await runDataBeforeHooks(runtime.lifecycle?.data, request, hookFrame);
  } catch (error) {
    const failed = runtimeDeniedResponse(
      "ATHENA_RUNTIME_CONFIG_INVALID",
      error instanceof Error ? error.message : String(error),
      GATEWAY_ENDPOINT[request.operation] ?? GATEWAY_ENDPOINT.fetch,
      500
    );
    emitRuntimeExecutionEvent(
      runtime,
      request,
      context,
      resolution,
      failed,
      started,
      "error",
      { ...correlation, errorPhase: "before_hooks", ...clock.timings() }
    );
    throw error;
  }

  clock.mark("execute");
  let response: AthenaGatewayResponse<unknown>;
  try {
    response = await sendAuthorizedTransport(
      runtime,
      request,
      authorized.payload
    );
  } catch (error) {
    const failed = runtimeDeniedResponse(
      "ATHENA_RUNTIME_UNSUPPORTED_OPERATION",
      error instanceof Error ? error.message : String(error),
      GATEWAY_ENDPOINT[request.operation] ?? GATEWAY_ENDPOINT.fetch,
      500
    );
    emitRuntimeExecutionEvent(
      runtime,
      request,
      context,
      resolution,
      failed,
      started,
      "error",
      { ...correlation, errorPhase: "execute", ...clock.timings() }
    );
    throw error;
  }

  if (!response.ok) {
    response = normalizeDataTransportFailure(response, {
      tableName: tableNameFromAuthorizedPayload(request.payload),
    });
  }

  const result = boundDataMutationResult(response);
  clock.mark("after_hooks");
  if (response.ok) {
    await runDataAfterHooks(runtime.lifecycle?.data, request, {
      ...hookFrame,
      result,
    });
  }
  const resource = resourceNameFromPayload(request.payload);
  emitExecutionEvent(
    runtime,
    request,
    context,
    resolution,
    response,
    started,
    undefined,
    {
      ...correlation,
      ...clock.timings(),
      audit: auditResourceMatch(
        resource,
        runtime.lifecycle?.data?.audit?.resources
      ),
    }
  );
  return response;
}

function enforcePolicy(
  runtime: AthenaServerRuntime,
  request: AthenaRuntimeRequest,
  context?: AthenaRuntimeRequestContext
): AthenaGatewayResponse<unknown> | undefined {
  const registry = runtime.policyRegistry;
  if (!registry || registry.mode === "disabled") {
    return;
  }
  const action = policyActionFromOperation(request.operation);
  if (!action) {
    return;
  }
  const resource = resourceNameFromPayload(request.payload);
  if (!resource) {
    if (registry.mode === "enforce") {
      return runtimeDeniedResponse(
        "ATHENA_POLICY_UNRESOLVED",
        "Athena Policy requires a modeled table_name.",
        GATEWAY_ENDPOINT[request.operation]
      );
    }
    return;
  }
  const decision = decidePolicy(registry, {
    action,
    principal:
      context?.resolvedPrincipal?.principal ?? anonymousAthenaPrincipal(),
    resource,
  });
  if (context) {
    context.policyDecision = decision;
  }
  if (registry.mode === "enforce" && !decision.allowed) {
    return runtimeDeniedResponse(
      "ATHENA_POLICY_DENIED",
      "Athena Policy denied this operation.",
      GATEWAY_ENDPOINT[request.operation]
    );
  }
  if (registry.mode === "enforce" && action) {
    const applied = applyAthenaPolicyDecision({
      action,
      decision,
      mode: registry.mode,
      payload: request.payload,
      principal:
        context?.resolvedPrincipal?.principal ?? anonymousAthenaPrincipal(),
    });
    if (!applied.ok) {
      return runtimeDeniedResponse(
        applied.code,
        applied.message,
        GATEWAY_ENDPOINT[request.operation]
      );
    }
    request.payload = applied.payload;
  }
}

function enforceModels(
  runtime: AthenaServerRuntime,
  request: AthenaRuntimeRequest
): AthenaGatewayResponse<unknown> | undefined {
  return runFinalModelValidation(runtime, request);
}

function inspectPayloadLimits(
  payload: unknown,
  limits: Parameters<typeof payloadLimitInspect.inspectPayloadLimits>[1]
): ReturnType<typeof payloadLimitInspect.inspectPayloadLimits> {
  return payloadLimitInspect.inspectPayloadLimits(payload, limits);
}

function enforceHttpLimits(
  runtime: AthenaServerRuntime,
  request: AthenaRuntimeRequest
): AthenaGatewayResponse<unknown> | undefined {
  return runFinalHttpLimits(runtime, request);
}

async function runDataBeforeHooks(
  hooks: Parameters<typeof dataNucleusHooks.runDataBeforeHooks>[0],
  request: AthenaRuntimeRequest,
  frame?: dataNucleusHooks.DataNucleusHookFrame
): Promise<void> {
  await dataNucleusHooks.runDataBeforeHooks(hooks, request, frame);
}

async function runDataAfterHooks(
  hooks: Parameters<typeof dataNucleusHooks.runDataAfterHooks>[0],
  request: AthenaRuntimeRequest,
  frame?: dataNucleusHooks.DataNucleusHookFrame
): Promise<void> {
  await dataNucleusHooks.runDataAfterHooks(hooks, request, frame);
}

function emitExecutionEvent(
  runtime: AthenaServerRuntime,
  request: AthenaRuntimeRequest,
  context: AthenaRuntimeRequestContext | undefined,
  resolution: PrincipalResolution,
  response: AthenaGatewayResponse<unknown>,
  started: number,
  errorKindOverride?: string,
  extras?: Parameters<typeof emitRuntimeExecutionEvent>[7]
): void {
  emitRuntimeExecutionEvent(
    runtime,
    request,
    context,
    resolution,
    response,
    started,
    errorKindOverride,
    extras
  );
}
