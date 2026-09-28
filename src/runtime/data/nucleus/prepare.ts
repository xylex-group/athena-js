import {
  type AthenaResourceLookup,
  resolveAthenaResourceFromPayload,
} from "../../../schema/resource.ts";
import { changedFieldsFromPayload } from "../lifecycle/scope.ts";
import type { AthenaDataLifecycleHooks } from "../lifecycle/types.ts";
import type { AthenaRuntimeRequest } from "../types.ts";
import { ATHENA_DATA_NUCLEUS_EVENTS } from "./catalog.ts";
import { cloneSanitizeAndFreezeMutationInput } from "./sanitize.ts";
import type {
  AthenaDataMutationInput,
  AthenaDataNucleusSemanticOperation,
  AthenaDataNucleusTransportOperation,
} from "./types.ts";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
}

function payloadRecord(payload: unknown): Record<string, unknown> | undefined {
  const bag = asRecord(payload);
  if (!bag) {
    return;
  }
  const body = bag.insert_body ?? bag.update_body;
  if (Array.isArray(body)) {
    return asRecord(body[0]);
  }
  return asRecord(body);
}

function payloadRecords(
  payload: unknown
): readonly Record<string, unknown>[] | undefined {
  const bag = asRecord(payload);
  if (!bag) {
    return;
  }
  const body = bag.insert_body ?? bag.update_body;
  if (Array.isArray(body)) {
    return body.filter(
      (item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === "object" && !Array.isArray(item)
    );
  }
  const single = asRecord(body);
  return single ? [single] : undefined;
}

function tableName(payload: unknown): string | undefined {
  const bag = asRecord(payload);
  return typeof bag?.table_name === "string" ? bag.table_name : undefined;
}

function transportOf(
  operation: AthenaRuntimeRequest["operation"]
): AthenaDataNucleusTransportOperation | undefined {
  if (
    operation === "insert" ||
    operation === "update" ||
    operation === "delete"
  ) {
    return operation;
  }
}

export function lifecycleEventName(
  request: AthenaRuntimeRequest
): AthenaDataMutationInput["event"] | undefined {
  const transport = transportOf(request.operation);
  if (!transport) {
    return;
  }
  if (request.semanticOperation === "upsert") {
    return ATHENA_DATA_NUCLEUS_EVENTS.upsert;
  }
  return ATHENA_DATA_NUCLEUS_EVENTS[transport];
}

function semanticOf(
  request: AthenaRuntimeRequest
): AthenaDataNucleusSemanticOperation | undefined {
  if (request.semanticOperation === "upsert") {
    return "upsert";
  }
  return transportOf(request.operation);
}

export function buildDataMutationInput(
  request: AthenaRuntimeRequest,
  modelIndex?: AthenaResourceLookup
): AthenaDataMutationInput | undefined {
  const event = lifecycleEventName(request);
  const transport = transportOf(request.operation);
  const semantic = semanticOf(request);
  if (!(event && transport && semantic)) {
    return;
  }
  const record = payloadRecord(request.payload);
  const records = payloadRecords(request.payload);
  const resource = resolveAthenaResourceFromPayload(
    request.payload,
    modelIndex
  );
  return {
    changedFields: changedFieldsFromPayload(request.payload),
    event,
    semanticOperation: semantic,
    transportOperation: transport,
    ...(record ? { record } : {}),
    ...(records ? { records } : {}),
    ...(resource
      ? {
          resource,
          table: resource.table,
          ...(resource.database ? { database: resource.database } : {}),
          ...(resource.model ? { model: resource.model } : {}),
          ...(resource.schema ? { schema: resource.schema } : {}),
        }
      : tableName(request.payload)
        ? { table: tableName(request.payload) }
        : {}),
  };
}

export function snapshotDataMutationInput(
  request: AthenaRuntimeRequest,
  modelIndex?: AthenaResourceLookup
): AthenaDataMutationInput | undefined {
  const input = buildDataMutationInput(request, modelIndex);
  if (!input) {
    return;
  }
  return cloneSanitizeAndFreezeMutationInput(input);
}

function applyPreparedBody(
  request: AthenaRuntimeRequest,
  prepared: unknown
): void {
  if (prepared === undefined || prepared === null) {
    return;
  }
  const bag = asRecord(request.payload);
  if (!bag) {
    return;
  }
  if (request.operation === "insert") {
    bag.insert_body = prepared as never;
    return;
  }
  if (request.operation === "update") {
    bag.update_body = prepared as never;
  }
}

/**
 * Pure transform. Completes before policy rewrite and final authorization.
 * `prepareDelete` is invoked for one-release compatibility; its return is never applied.
 */
export async function prepareDataMutation(
  hooks: AthenaDataLifecycleHooks | undefined,
  request: AthenaRuntimeRequest,
  modelIndex?: AthenaResourceLookup
): Promise<void> {
  if (!hooks) {
    return;
  }
  const event = snapshotDataMutationInput(request, modelIndex);
  if (!event) {
    return;
  }
  let prepared: unknown;
  if (event.event === ATHENA_DATA_NUCLEUS_EVENTS.upsert) {
    if (hooks.prepareUpsert) {
      prepared = await hooks.prepareUpsert(event);
    }
  } else if (request.operation === "insert" && hooks.prepareInsert) {
    prepared = await hooks.prepareInsert(event);
  } else if (request.operation === "update" && hooks.prepareUpdate) {
    prepared = await hooks.prepareUpdate(event);
  } else if (request.operation === "delete" && hooks.prepareDelete) {
    await hooks.prepareDelete(event);
  }
  applyPreparedBody(request, prepared);
}
