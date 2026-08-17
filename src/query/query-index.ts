import type { AthenaQueryDescriptor, AthenaQueryTarget } from "./descriptor.ts";

export function athenaModelIndexKey(target: AthenaQueryTarget): string {
  return `${target.database ?? ""}:${target.schema ?? ""}:${target.table}`;
}

export function athenaFieldIndexKey(
  target: AthenaQueryTarget,
  column: string
): string {
  return `${athenaModelIndexKey(target)}.${column}`;
}

export function athenaScopeIndexKey(
  context: AthenaQueryDescriptor["context"]
): string {
  return [
    context?.organizationId ?? "",
    context?.userId ?? "",
    context?.accessScope ?? "",
    context?.policyRevision ?? "",
  ].join("|");
}

export class AthenaQueryGraphIndex {
  readonly byEntity = new Map<string, Set<string>>();
  readonly byField = new Map<string, Set<string>>();
  readonly byModel = new Map<string, Set<string>>();
  readonly byScope = new Map<string, Set<string>>();

  indexQuery(queryId: string, descriptor: AthenaQueryDescriptor): void {
    this.add(this.byModel, athenaModelIndexKey(descriptor.target), queryId);
    this.add(this.byScope, athenaScopeIndexKey(descriptor.context), queryId);
    for (const field of descriptor.dependency.fields) {
      this.add(
        this.byField,
        athenaFieldIndexKey(descriptor.target, field.column),
        queryId
      );
    }
    for (const relation of descriptor.dependency.relations) {
      if (relation.targetModel) {
        this.add(
          this.byModel,
          `::${relation.targetModel}`,
          queryId
        );
      }
    }
  }

  indexEntity(queryId: string, entityToken: string): void {
    this.add(this.byEntity, entityToken, queryId);
  }

  unindexQuery(
    queryId: string,
    descriptor?: AthenaQueryDescriptor,
    entityRefs?: readonly string[]
  ): void {
    if (descriptor) {
      this.remove(this.byModel, athenaModelIndexKey(descriptor.target), queryId);
      this.remove(this.byScope, athenaScopeIndexKey(descriptor.context), queryId);
      for (const field of descriptor.dependency.fields) {
        this.remove(
          this.byField,
          athenaFieldIndexKey(descriptor.target, field.column),
          queryId
        );
      }
      for (const relation of descriptor.dependency.relations) {
        if (relation.targetModel) {
          this.remove(this.byModel, `::${relation.targetModel}`, queryId);
        }
      }
    }
    for (const token of entityRefs ?? []) {
      this.remove(this.byEntity, token, queryId);
    }
  }

  queriesForEntity(token: string): Set<string> {
    return this.byEntity.get(token) ?? new Set();
  }

  queriesForModel(target: AthenaQueryTarget): Set<string> {
    return this.byModel.get(athenaModelIndexKey(target)) ?? new Set();
  }

  queriesForField(target: AthenaQueryTarget, column: string): Set<string> {
    return this.byField.get(athenaFieldIndexKey(target, column)) ?? new Set();
  }

  private add(map: Map<string, Set<string>>, key: string, queryId: string) {
    const existing = map.get(key);
    if (existing) {
      existing.add(queryId);
      return;
    }
    map.set(key, new Set([queryId]));
  }

  private remove(
    map: Map<string, Set<string>>,
    key: string,
    queryId: string
  ) {
    const existing = map.get(key);
    if (!existing) {
      return;
    }
    existing.delete(queryId);
    if (existing.size === 0) {
      map.delete(key);
    }
  }
}
