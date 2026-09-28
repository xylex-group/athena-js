import type { AthenaQueryDescriptor } from "../../query/descriptor.ts";
import type { AthenaEntityKey } from "../../query/model-identity.ts";
import { athenaEntityKeyToken } from "../../query/model-identity.ts";
import { AthenaQueryGraphIndex } from "../../query/query-index.ts";

export class QueryClientGraphIndex {
  private readonly index = new AthenaQueryGraphIndex();

  indexQuery(queryId: string, descriptor: AthenaQueryDescriptor): void {
    this.index.indexQuery(queryId, descriptor);
  }

  indexEntity(queryId: string, entityToken: string): void {
    this.index.indexEntity(queryId, entityToken);
  }

  unindexQuery(
    queryId: string,
    descriptor?: AthenaQueryDescriptor,
    entityRefs?: readonly string[]
  ): void {
    this.index.unindexQuery(queryId, descriptor, entityRefs);
  }

  collectAffectedQueryIds(
    key: AthenaEntityKey,
    changedFields: readonly string[],
    mutation?: AthenaQueryDescriptor
  ): Set<string> {
    const ids = new Set<string>();
    const token = athenaEntityKeyToken(key);
    for (const queryId of this.index.queriesForEntity(token)) {
      ids.add(queryId);
    }
    for (const queryId of this.index.queriesForModel({
      database: key.model.database,
      schema: key.model.schema,
      table: key.model.table,
    })) {
      ids.add(queryId);
    }
    for (const field of changedFields) {
      for (const queryId of this.index.queriesForField(
        {
          database: key.model.database,
          schema: key.model.schema,
          table: key.model.table,
        },
        field
      )) {
        ids.add(queryId);
      }
    }
    if (mutation?.target.model) {
      for (const queryId of this.index.byModel.get(
        `::${mutation.target.model}`
      ) ?? []) {
        ids.add(queryId);
      }
    }
    return ids;
  }
}
