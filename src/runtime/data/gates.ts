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
import { readRuntimeErrorCode, runtimeDeniedResponse } from "./errors.ts";
import { createAthenaRuntimeExecutionEvent } from "./execution-event.ts";
import { hasMutationPredicate, inspectPayloadLimits } from "./limits.ts";
import {
  referencedFields,
  referencedRelations,
  resourceNameFromPayload,
} from "./model-registry.ts";
import { isPrivilegedHttpDataResource } from "./privileged-http-models.ts";
import type {
  AthenaRuntimeErrorCode,
  AthenaRuntimeExecutionEvent,
  AthenaRuntimeRequest,
  AthenaRuntimeRequestContext,
  AthenaServerRuntime,
} from "./types.ts";

export const ENDPOINT = {
  delete: "/gateway/delete",
  fetch: "/gateway/fetch",
  insert: "/gateway/insert",
  query: "/gateway/query",
  rpc: "/gateway/rpc",
  update: "/gateway/update",
} as const;

export function enforceHttpLimits(
  runtime: AthenaServerRuntime,
  request: AthenaRuntimeRequest
): AthenaGatewayResponse<unknown> | undefined {
  const profile = runtime.httpProfile;
  if (!profile.enabled) {
    return;
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
    return;
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

export function enforceModels(
  runtime: AthenaServerRuntime,
  request: AthenaRuntimeRequest
): AthenaGatewayResponse<unknown> | undefined {
  const enforcement = runtime.capabilities.modelEnforcement;
  if (request.operation === "query" || request.operation === "rpc") {
    return;
  }
  const resource = resourceNameFromPayload(request.payload);
  const endpoint = ENDPOINT[request.operation];
  if (
    runtime.httpProfile.enabled &&
    resource &&
    isPrivilegedHttpDataResource(resource)
  ) {
    return runtimeDeniedResponse(
      "ATHENA_MODEL_NOT_EXPOSED",
      `Resource "${resource}" is not exposed by the runtime model registry.`,
      endpoint
    );
  }
  if (enforcement === "off" || !runtime.modelIndex) {
    return;
  }
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
    return;
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
    const bare = field.includes(".")
      ? (field.split(".").pop() ?? field)
      : field;
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
}

export function emitExecutionEvent(
  runtime: AthenaServerRuntime,
  request: AthenaRuntimeRequest,
  context: AthenaRuntimeRequestContext | undefined,
  resolution: {
    resolved?: { authority?: string };
  },
  response: AthenaGatewayResponse<unknown>,
  started: number,
  errorKindOverride?: string,
  extras?: Partial<AthenaRuntimeExecutionEvent>
): void {
  runtime.onExecutionEvent?.(
    createAthenaRuntimeExecutionEvent({
      affectedRows:
        typeof response.count === "number" ? response.count : undefined,
      backend: runtime.capabilities.transport,
      decision: response.ok ? "allow" : "deny",
      errorKind: response.ok
        ? undefined
        : (errorKindOverride ??
          readRuntimeErrorCode(response) ??
          response.errorDetails?.code ??
          "error"),
      executeMs: extras?.executeMs ?? Date.now() - started,
      operation: request.operation,
      policyIds: context?.policyDecision?.matchedPolicyIds
        ? [...context.policyDecision.matchedPolicyIds]
        : undefined,
      principalAuthority: resolution.resolved?.authority,
      requestId: extras?.requestId ?? context?.requestId ?? "embedded",
      resource: resourceNameFromPayload(request.payload),
      runtime: "embedded",
      ...extras,
    })
  );
}

export async function dispatchAthenaTransport(
  runtime: AthenaServerRuntime,
  request: AthenaRuntimeRequest,
  payload: unknown
): Promise<AthenaGatewayResponse<unknown>> {
  const transport: AthenaGatewayClient = runtime.transport;
  switch (request.operation) {
    case "fetch":
      return transport.fetchGateway(payload as AthenaFetchPayload);
    case "insert":
      return transport.insertGateway(payload as AthenaInsertPayload);
    case "update":
      return transport.updateGateway(payload as AthenaUpdatePayload);
    case "delete":
      return transport.deleteGateway(payload as AthenaDeletePayload);
    case "query":
      if (!runtime.capabilities.rawSql) {
        return runtimeDeniedResponse(
          "ATHENA_RAW_SQL_FORBIDDEN",
          "Raw SQL is disabled on this Athena Local Runtime.",
          ENDPOINT.query
        );
      }
      return transport.queryGateway(payload as AthenaQueryPayload);
    case "rpc": {
      if (!runtime.capabilities.rpc) {
        return runtimeDeniedResponse(
          "ATHENA_RPC_FORBIDDEN",
          "RPC is disabled on this Athena Local Runtime.",
          ENDPOINT.rpc
        );
      }
      const rpcPayload = payload as AthenaRpcPayload;
      const name = rpcPayload.function || rpcPayload.function_name || "";
      if (!(name && runtime.rpcExpose?.has(name))) {
        return runtimeDeniedResponse(
          "ATHENA_RPC_NOT_EXPOSED",
          "RPC function is not on the Athena expose allowlist.",
          ENDPOINT.rpc
        );
      }
      return transport.rpcGateway(rpcPayload);
    }
    default: {
      const _never: never = request.operation;
      return runtimeDeniedResponse(
        "ATHENA_RUNTIME_UNSUPPORTED_OPERATION",
        `Unsupported Athena Local Runtime operation: ${String(_never)}`,
        ENDPOINT.fetch,
        400
      );
    }
  }
}
