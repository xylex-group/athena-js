/**
 * Shared physical resource identity for Schema IR, Policy IR, the runtime
 * model index, and Data Nucleus. `model` is Schema IR identity, not a table alias.
 */

export type AthenaResourceKind =
  | "relation"
  | "storage-object"
  | "auth"
  | "service";

export type AthenaResourceInput = {
  table: string;
  schema?: string;
  database?: string;
};

export type AthenaResourceRef =
  | { table: string; schema?: never; database?: never }
  | { schema: string; table: string; database?: string };

export type AthenaResourceIdentity =
  | {
      kind: "relation";
      ref: AthenaResourceRef;
      canonicalResource: string;
      model?: string;
    }
  | {
      kind: "storage-object";
      bucket?: string;
      key: string;
      canonicalResource: string;
    }
  | {
      kind: "auth";
      resource: string;
      canonicalResource: string;
    }
  | {
      kind: "service";
      service: string;
      canonicalResource: string;
    };

export interface AthenaResolvedResource {
  table: string;
  schema?: string;
  database?: string;
  canonicalResource: string;
  model?: string;
}

export type AthenaResourceLookup = {
  get(resource: string): AthenaResolvedResource | undefined;
};

function trimOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function parseAthenaResourceRef(value: string): AthenaResourceRef {
  const parts = value
    .trim()
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length >= 3) {
    return {
      database: parts[0],
      schema: parts[1],
      table: parts[parts.length - 1] as string,
    };
  }
  if (parts.length === 2) {
    return {
      schema: parts[0],
      table: parts[1] as string,
    };
  }
  return { table: parts[0] ?? "" };
}

export function normalizeAthenaResourceRef(
  ref: AthenaResourceInput,
): AthenaResourceRef {
  const table = ref.table.trim();
  const schema = trimOptional(ref.schema);
  const database = schema ? trimOptional(ref.database) : undefined;
  if (schema) {
    return database ? { database, schema, table } : { schema, table };
  }
  return { table };
}

export function canonicalAthenaResource(ref: AthenaResourceInput): string {
  const normalized = normalizeAthenaResourceRef(ref);
  if ("schema" in normalized && normalized.schema) {
    return normalized.database
      ? `${normalized.database}.${normalized.schema}.${normalized.table}`
      : `${normalized.schema}.${normalized.table}`;
  }
  return normalized.table;
}

export function athenaResourceKeys(ref: AthenaResourceInput): string[] {
  const normalized = normalizeAthenaResourceRef(ref);
  const keys = new Set<string>();
  if (normalized.table) {
    keys.add(normalized.table);
  }
  if ("schema" in normalized && normalized.schema && normalized.table) {
    keys.add(`${normalized.schema}.${normalized.table}`);
    if (normalized.database) {
      keys.add(
        `${normalized.database}.${normalized.schema}.${normalized.table}`,
      );
    }
  }
  return [...keys];
}

export function resolvedAthenaResource(
  ref: AthenaResourceInput & { model?: string },
): AthenaResolvedResource {
  const normalized = normalizeAthenaResourceRef(ref);
  const model = trimOptional(ref.model);
  return {
    ...normalized,
    canonicalResource: canonicalAthenaResource(normalized),
    ...(model ? { model } : {}),
  };
}

function pickResolved(
  value: AthenaResolvedResource,
): AthenaResolvedResource {
  return resolvedAthenaResource(value);
}

function rawResourceToken(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return undefined;
  }
  const record = payload as Record<string, unknown>;
  const table =
    typeof record.table_name === "string" ? record.table_name.trim() : "";
  const view =
    typeof record.view_name === "string" ? record.view_name.trim() : "";
  return table || view || undefined;
}

export function resolveAthenaResourceFromPayload(
  payload: unknown,
  modelIndex?: AthenaResourceLookup,
): AthenaResolvedResource | undefined {
  const token = rawResourceToken(payload);
  if (!token) {
    return undefined;
  }
  const parsed = parseAthenaResourceRef(token);
  const candidates = [
    token,
    canonicalAthenaResource(parsed),
    ...athenaResourceKeys(parsed),
  ];
  if (modelIndex) {
    for (const candidate of candidates) {
      const found = modelIndex.get(candidate);
      if (found) {
        return pickResolved(found);
      }
    }
  }
  if (!parsed.table) {
    return undefined;
  }
  return resolvedAthenaResource(parsed);
}

export function relationResourceIdentity(
  ref: AthenaResourceInput & { model?: string },
): AthenaResourceIdentity {
  const resolved = resolvedAthenaResource(ref);
  return {
    kind: "relation",
    ref: normalizeAthenaResourceRef(ref),
    canonicalResource: resolved.canonicalResource,
    ...(resolved.model ? { model: resolved.model } : {}),
  };
}

export function storageObjectResourceIdentity(input: {
  bucket?: string;
  key: string;
}): AthenaResourceIdentity {
  const key = input.key.trim();
  const bucket = trimOptional(input.bucket);
  return {
    kind: "storage-object",
    ...(bucket ? { bucket } : {}),
    key,
    canonicalResource: bucket ? `${bucket}/${key}` : key,
  };
}

export function authResourceIdentity(resource: string): AthenaResourceIdentity {
  const token = resource.trim();
  return {
    kind: "auth",
    resource: token,
    canonicalResource: token,
  };
}

export function serviceResourceIdentity(service: string): AthenaResourceIdentity {
  const token = service.trim();
  return {
    kind: "service",
    service: token,
    canonicalResource: token,
  };
}

export function canonicalAthenaResourceIdentity(
  identity: AthenaResourceIdentity,
): string {
  return identity.canonicalResource;
}

export function matchAthenaResource(
  scope: AthenaResourceInput | string,
  resolved: AthenaResolvedResource,
): boolean {
  const ref = normalizeAthenaResourceRef(
    typeof scope === "string" ? parseAthenaResourceRef(scope) : scope,
  );
  if (!ref.table.trim() || ref.table.trim() !== resolved.table) {
    return false;
  }
  const scopeSchema = ref.schema;
  if (scopeSchema && scopeSchema !== resolved.schema) {
    return false;
  }
  const scopeDatabase = ref.database;
  if (scopeDatabase && scopeDatabase !== resolved.database) {
    return false;
  }
  return true;
}
