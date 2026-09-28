import type { AthenaCacheContextDescriptor } from "../../query/descriptor.ts";
import { mergeEntityRow } from "../../query/entity-graph.ts";
import type { AthenaEntityKey } from "../../query/model-identity.ts";
import {
  athenaEntityKeyToken,
  createAthenaEntityKey,
  entityKeyFromSinglePrimary,
} from "../../query/model-identity.ts";
import type { AthenaModelTarget } from "../../schema/types.ts";

export interface EntityEntry {
  data: Record<string, unknown>;
  key: AthenaEntityKey;
  updatedAt: number;
}

export class EntityStore {
  private readonly entries = new Map<string, EntityEntry>();

  get<TRow = Record<string, unknown>>(key: AthenaEntityKey): TRow | undefined {
    return this.entries.get(athenaEntityKeyToken(key))?.data as
      | TRow
      | undefined;
  }

  getByToken(token: string): EntityEntry | undefined {
    return this.entries.get(token);
  }

  merge(key: AthenaEntityKey, row: Record<string, unknown>): void {
    const token = athenaEntityKeyToken(key);
    const current = this.entries.get(token);
    this.entries.set(token, {
      data: mergeEntityRow(current?.data, row),
      key,
      updatedAt: Date.now(),
    });
  }

  setToken(token: string, entry: EntityEntry): void {
    this.entries.set(token, entry);
  }

  delete(key: AthenaEntityKey): void {
    this.entries.delete(athenaEntityKeyToken(key));
  }

  clear(): void {
    this.entries.clear();
  }

  snapshot(): Map<string, EntityEntry> {
    return new Map(this.entries);
  }

  restore(entries: Map<string, EntityEntry>): void {
    this.entries.clear();
    for (const [token, entry] of entries) {
      this.entries.set(token, entry);
    }
  }

  dehydrate(): Array<{ data: Record<string, unknown>; token: string }> {
    return [...this.entries.entries()].map(([token, entry]) => ({
      data: entry.data,
      token,
    }));
  }

  ingestDehydrated(
    entities: ReadonlyArray<{ data: Record<string, unknown>; token: string }>
  ): void {
    for (const entity of entities) {
      this.entries.set(entity.token, {
        data: entity.data,
        key: {
          context: null,
          model: { table: "" },
          primaryKey: [],
        },
        updatedAt: Date.now(),
      });
    }
  }
}

export function resolveModelRowKey(
  model: AthenaModelTarget,
  id: unknown,
  context?: AthenaCacheContextDescriptor
): AthenaEntityKey {
  if (typeof id === "object" && id !== null) {
    return createAthenaEntityKey(model, id, context);
  }
  return entityKeyFromSinglePrimary(model, id, context);
}
