export type AthenaDataMutationScope = {
  changedFieldsFromPayload: (payload: unknown) => string[];
};

export function changedFieldsFromPayload(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }
  const record = payload as Record<string, unknown>;
  const body = record.insert_body ?? record.update_body ?? record.record;
  if (Array.isArray(body)) {
    const keys = new Set<string>();
    for (const item of body) {
      if (item && typeof item === "object") {
        for (const key of Object.keys(item as object)) {
          keys.add(key);
        }
      }
    }
    return [...keys];
  }
  if (body && typeof body === "object") {
    return Object.keys(body as object);
  }
  return [];
}

export function createDataMutationScope(): AthenaDataMutationScope {
  return {
    changedFieldsFromPayload,
  };
}
