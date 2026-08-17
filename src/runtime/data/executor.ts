import type { AthenaGatewayClient } from "../../gateway/client.ts";
import type {
  AthenaDeletePayload,
  AthenaFetchPayload,
  AthenaGatewayResponse,
  AthenaInsertPayload,
  AthenaQueryPayload,
  AthenaRpcPayload,
  AthenaUpdatePayload,
} from "../../gateway/types.ts";
import { runtimeDeniedResponse } from "./errors.ts";
import { createAthenaRuntimeExecutionEvent } from "./execution-event.ts";
import { hasMutationPredicate, inspectPayloadLimits } from "./limits.ts";
import { applyAthenaPolicyDecision } from "../../policy/apply.ts";
import { actionFromRuntimeOperation } from "../../policy/decision.ts";
import { decideAthenaPolicy } from "../../policy/decide.ts";
import { resolveAthenaRuntimePrincipal } from "./resolve-principal.ts";
import { anonymousAthenaPrincipal } from "./principal.ts";
import {
  referencedFields,
  referencedRelations,
  resourceNameFromPayload,
} from "./model-registry.ts";
import type {
  AthenaRuntimeErrorCode,
  AthenaRuntimeRequest,
  AthenaRuntimeRequestContext,
  AthenaServerRuntime,
} from "./types.ts";

const ENDPOINT = {
  delete: "/gateway/delete",
  fetch: "/gateway/fetch",
  insert: "/gateway/insert",
  query: "/gateway/query",
  rpc: "/gateway/rpc",
  update: "/gateway/update",
} as const;

function enforceHttpLimits(
  runtime: AthenaServerRuntime,
  request: AthenaRuntimeRequest
): AthenaGatewayResponse<unknown> | undefined {
  const profile = runtime.httpProfile;
  if (!profile.enabled) {
    return undefined;
  }
  const endpoint = ENDPOINT[request.operation] ?? ENDPOINT.fetch;
  if (
    (request.operation === "update" || request.operation === "delete") &&
    !profile.allowUnboundedMutations &&
    !hasMutationPredicate(request.payload)
  ) {
    return runtimeDeniedResponse(
      "ATHENA_UNBOUNDED_MUTATION",
      "Athena rejected an unbounded UPDATE/DELETE. Supply a predicate or resource_id.",
      endpoint
    );
  }
  const violation = inspectPayloadLimits(request.payload, profile.limits);
  if (!violation) {
    return undefined;
  }
  if (violation.kind === "insert") {
    return runtimeDeniedResponse(
      "ATHENA_LIMIT_EXCEEDED",
      `Insert batch exceeds maxInsertRows (${violation.limit}).`,
      endpoint
    );
  }
  if (violation.kind === "in") {
    return runtimeDeniedResponse(
      "ATHENA_LIMIT_EXCEEDED",
      `IN list exceeds maxInItems (${violation.limit}).`,
      endpoint
    );
  }
  return runtimeDeniedResponse(
    "ATHENA_LIMIT_EXCEEDED",
    `Requested page size exceeds maxPageSize (${violation.limit}).`,
    endpoint
  );
}

function enforcePolicy(
  runtime: AthenaServerRuntime,
  request: AthenaRuntimeRequest,
  context?: AthenaRuntimeRequestContext
): AthenaGatewayResponse<unknown> | undefined {
  const registry = runtime.policyRegistry;
  if (!registry || registry.mode === "disabled") {
    return undefined;
  }
  const action = actionFromRuntimeOperation(request.operation);
  if (!action) {
    return undefined;
  }
  const resource = resourceNameFromPayload(request.payload);
  if (!resource) {
    if (registry.mode === "enforce") {
      return runtimeDeniedResponse(
        "ATHENA_POLICY_UNRESOLVED",
        "Athena Policy requires a modeled table_name.",
        ENDPOINT[request.operation]
      );
    }
    return undefined;
  }
  const decision = decideAthenaPolicy(registry, {
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
      ENDPOINT[request.operation]
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
        ENDPOINT[request.operation]
      );
    }
    request.payload = applied.payload;
  }
  return undefined;
}

function enforceModels(
  runtime: AthenaServerRuntime,
  request: AthenaRuntimeRequest
): AthenaGatewayResponse<unknown> | undefined {
  const enforcement = runtime.capabilities.modelEnforcement;
  if (enforcement === "off" || !runtime.modelIndex) {
    return undefined;
  }
  if (
    request.operation === "query" ||
    request.operation === "rpc"
  ) {
    return undefined;
  }
  const resource = resourceNameFromPayload(request.payload);
  const endpoint = ENDPOINT[request.operation];
  if (!resource) {
    return runtimeDeniedResponse(
      "ATHENA_MODEL_NOT_EXPOSED",
      "Athena Local Runtime requires a modeled table_name.",
      endpoint
    );
  }
  const descriptor = runtime.modelIndex.get(resource);
  if (!descriptor) {
    return runtimeDeniedResponse(
      "ATHENA_MODEL_NOT_EXPOSED",
      `Resource "${resource}" is not exposed by the runtime model registry.`,
      endpoint
    );
  }
  if (enforcement !== "strict") {
    return undefined;
  }
  const relations = referencedRelations(request.payload);
  for (const name of relations) {
    if (descriptor.columns.has(name) || descriptor.relations.has(name)) {
      continue;
    }
    return runtimeDeniedResponse(
      "ATHENA_MODEL_UNKNOWN_RELATION",
      `Relation "${name}" is not declared on ${descriptor.canonicalResource}.`,
      endpoint
    );
  }
  for (const field of referencedFields(request.payload)) {
    const bare = field.includes(".") ? field.split(".").pop() ?? field : field;
    if (descriptor.columns.has(field) || descriptor.columns.has(bare)) {
      continue;
    }
    if (descriptor.relations.has(field) || descriptor.relations.has(bare)) {
      continue;
    }
    return runtimeDeniedResponse(
      "ATHENA_MODEL_UNKNOWN_FIELD" satisfies AthenaRuntimeErrorCode,
      `Field "${field}" is not declared on ${descriptor.canonicalResource}.`,
      endpoint
    );
  }
  return undefined;
}

export async function executeAthenaRequest(
  runtime: AthenaServerRuntime,
  request: AthenaRuntimeRequest,
  context?: AthenaRuntimeRequestContext
): Promise<AthenaGatewayResponse<unknown>> {
  const resolution = await resolveAthenaRuntimePrincipal(
    runtime.authMaterial,
    runtime.capabilities.security,
    context
  );
  if (!resolution.ok) {
    return runtimeDeniedResponse(
      resolution.failure.code,
      resolution.failure.message,
      ENDPOINT[request.operation] ?? ENDPOINT.fetch,
      resolution.failure.status
    );
  }
  if (context) {
    context.resolvedPrincipal = resolution.resolved;
  }
  const denied = enforceModels(runtime, request);
  if (denied) {
    return denied;
  }
  const policyDenied = enforcePolicy(runtime, request, context);
  if (policyDenied) {
    return policyDenied;
  }
  const limited = enforceHttpLimits(runtime, request);
  if (limited) {
    return limited;
  }
  const transport: AthenaGatewayClient = runtime.transport;
  const started = Date.now();
  let response: AthenaGatewayResponse<unknown>;
  switch (request.operation) {
    case "fetch":
      response = await transport.fetchGateway(
        request.payload as AthenaFetchPayload
      );
      break;
    case "insert":
      response = await transport.insertGateway(
        request.payload as AthenaInsertPayload
      );
      break;
    case "update":
      response = await transport.updateGateway(
        request.payload as AthenaUpdatePayload
      );
      break;
    case "delete":
      response = await transport.deleteGateway(
        request.payload as AthenaDeletePayload
      );
      break;
    case "query":
      if (!runtime.capabilities.rawSql) {
        response = runtimeDeniedResponse(
          "ATHENA_RAW_SQL_FORBIDDEN",
          "Raw SQL is disabled on this Athena Local Runtime.",
          ENDPOINT.query
        );
        break;
      }
      response = await transport.queryGateway(
        request.payload as AthenaQueryPayload
      );
      break;
    case "rpc":
      if (!runtime.capabilities.rpc) {
        response = runtimeDeniedResponse(
          "ATHENA_RPC_FORBIDDEN",
          "RPC is disabled on this Athena Local Runtime.",
          ENDPOINT.rpc
        );
        break;
      }
      {
        const payload = request.payload as AthenaRpcPayload;
        const name = payload.function || payload.function_name || "";
        if (!name || !runtime.rpcExpose?.has(name)) {
          response = runtimeDeniedResponse(
            "ATHENA_RPC_NOT_EXPOSED",
            "RPC function is not on the Athena expose allowlist.",
            ENDPOINT.rpc
          );
          break;
        }
        response = await transport.rpcGateway(payload);
        break;
      }
    default: {
      const _never: never = request.operation;
      response = runtimeDeniedResponse(
        "ATHENA_RUNTIME_UNSUPPORTED_OPERATION",
        `Unsupported Athena Local Runtime operation: ${String(_never)}`,
        ENDPOINT.fetch,
        400
      );
    }
  }
  runtime.onExecutionEvent?.(
    createAthenaRuntimeExecutionEvent({
      affectedRows:
        typeof response.count === "number" ? response.count : undefined,
      backend: runtime.capabilities.transport,
      decision: response.ok ? "allow" : "deny",
      errorKind: response.ok ? undefined : (response.errorDetails?.code ?? "error"),
      executeMs: Date.now() - started,
      operation: request.operation,
      policyIds: context?.policyDecision?.matchedPolicyIds
        ? [...context.policyDecision.matchedPolicyIds]
        : undefined,
      principalAuthority: resolution.resolved.authority,
      requestId: context?.requestId ?? "embedded",
      resource: resourceNameFromPayload(request.payload),
      runtime: "embedded",
    })
  );
  return response;
}
