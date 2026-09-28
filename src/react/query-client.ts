import type {
  AthenaCacheContextDescriptor,
  AthenaExecutable,
  AthenaQueryDescriptor,
} from "../query/descriptor.ts";
import {
  buildAthenaModelScopeKey,
  isAthenaExecutable,
  resolveAthenaQueryTarget,
} from "../query/descriptor.ts";
import {
  type AthenaNormalizedQueryPage,
  extractResultRows,
  isCollectionOperation,
  mapResultRows,
  mutationTouchesQueryMembership,
  queryDependsOnRelationTarget,
  removeResultRows,
  sameCacheContext,
  sameModelTarget,
} from "../query/entity-graph.ts";
import type { AthenaEntityKey } from "../query/model-identity.ts";
import {
  athenaEntityKeyToken,
  createAthenaEntityKey,
} from "../query/model-identity.ts";
import type { AthenaModelTarget } from "../schema/types.ts";
import {
  EntityStore,
  resolveModelRowKey,
} from "./query-client/entity-store.ts";
import { QueryClientGraphIndex } from "./query-client/graph-index.ts";
import type { ExecuteMutationInput } from "./query-client/mutation-store.ts";
import { MutationStore } from "./query-client/mutation-store.ts";
import {
  type ExecuteQueryInput,
  type QueryEntry,
  QueryStore,
} from "./query-client/query-store.ts";
import type {
  AthenaInvalidateQueriesFilters,
  AthenaMutationDefaults,
  AthenaQueryClientConfig,
  AthenaQueryDefaults,
  AthenaRuntimeEvent,
  AthenaStateAdapter,
  AthenaUnsubscribe,
  QueryKey,
} from "./types.ts";
import { matchesQueryKey, safeSerializeQueryKey } from "./utils.ts";

export interface AthenaCacheTransaction {
  insert(queryKey: QueryKey, row: Record<string, unknown>): void;
  remove(queryKey: QueryKey, id: unknown): void;
  update(
    model: AthenaModelTarget,
    id: unknown,
    updater:
      | Record<string, unknown>
      | ((
          current: Record<string, unknown> | undefined
        ) => Record<string, unknown>)
  ): void;
}

export interface AthenaDehydratedCache {
  entities: Array<{
    data: Record<string, unknown>;
    token: string;
  }>;
  queries: Array<{
    data: unknown;
    descriptor?: AthenaQueryDescriptor;
    normalizedPage?: AthenaNormalizedQueryPage;
    queryKey: QueryKey;
    updatedAt?: number;
  }>;
}

export interface AthenaModelCache<TRow = Record<string, unknown>> {
  get(id: unknown): TRow | undefined;
  invalidate(): Promise<void>;
  invalidateEntity(id: unknown): Promise<void>;
  set(row: TRow): TRow;
  update(
    id: unknown,
    updater: Partial<TRow> | ((current: TRow | undefined) => TRow)
  ): TRow;
}

export class AthenaQueryClient {
  private readonly entities = new EntityStore();
  private readonly graph = new QueryClientGraphIndex();
  private readonly queries: QueryStore;
  private readonly mutations: MutationStore;
  private readonly eventSubscribers = new Set<
    (event: AthenaRuntimeEvent) => void
  >();
  private readonly adapters = new Set<AthenaStateAdapter>();
  private requestCounter = 0;

  readonly config: AthenaQueryClientConfig;
  readonly defaultQueryOptions: AthenaQueryDefaults;
  readonly defaultMutationOptions: AthenaMutationDefaults;

  constructor(config: AthenaQueryClientConfig = {}) {
    this.config = {
      cache: {
        gcTime: config.cache?.gcTime,
        mode: config.cache?.mode ?? "none",
        staleTime: config.cache?.staleTime,
      },
      defaultMutationOptions: config.defaultMutationOptions,
      defaultQueryOptions: config.defaultQueryOptions,
    };
    this.defaultQueryOptions = {
      refetchOnMount: config.defaultQueryOptions?.refetchOnMount ?? true,
      refetchOnReconnect:
        config.defaultQueryOptions?.refetchOnReconnect ?? false,
      refetchOnWindowFocus:
        config.defaultQueryOptions?.refetchOnWindowFocus ?? false,
      retry: config.defaultQueryOptions?.retry ?? 0,
      retryDelay: config.defaultQueryOptions?.retryDelay,
    };
    this.defaultMutationOptions = {
      retry: config.defaultMutationOptions?.retry ?? 0,
      retryDelay: config.defaultMutationOptions?.retryDelay,
    };
    this.queries = new QueryStore({
      config: this.config,
      emitEvent: (event) => this.emitEvent(event),
      entities: this.entities,
      graph: this.graph,
      nextRequestId: () => {
        this.requestCounter += 1;
        return this.requestCounter;
      },
    });
    this.mutations = new MutationStore({
      config: this.config,
      emitEvent: (event) => this.emitEvent(event),
      nextRequestId: () => {
        this.requestCounter += 1;
        return this.requestCounter;
      },
    });
  }

  getQueryKeyToken(queryKey: QueryKey): string {
    return safeSerializeQueryKey(queryKey);
  }

  getQueryKey(query: QueryKey | AthenaExecutable<unknown>): QueryKey {
    if (isAthenaExecutable(query)) {
      return query.getDescriptor().queryKey;
    }
    return query;
  }

  getQueryData<TData = unknown>(queryKey: QueryKey): TData | undefined {
    return this.queries.getQueryData(this.getQueryKeyToken(queryKey));
  }

  getNormalizedQueryPage(
    queryKey: QueryKey
  ): AthenaNormalizedQueryPage | undefined {
    return this.queries.getNormalizedPage(this.getQueryKeyToken(queryKey));
  }

  setQueryData<TData>(
    queryKey: QueryKey,
    updater: TData | ((previous: TData | undefined) => TData)
  ): TData {
    return this.queries.setQueryData(
      queryKey,
      this.getQueryKeyToken(queryKey),
      updater
    );
  }

  async invalidateQueries(
    filters: AthenaInvalidateQueriesFilters = {}
  ): Promise<void> {
    const exact = filters.exact === true;
    const shouldRefetch = filters.refetch !== false;
    const matched: QueryEntry[] = [];

    for (const entry of this.queries.values()) {
      if (entry.queryKey === undefined) {
        continue;
      }
      if (
        filters.queryKey === undefined ||
        matchesQueryKey(entry.queryKey, filters.queryKey, exact)
      ) {
        matched.push(entry);
      }
    }

    const refetches: Promise<unknown>[] = [];
    for (const entry of matched) {
      this.queries.setState(
        entry,
        {
          ...entry.state,
          updatedAt: undefined,
        },
        "query_updated"
      );

      if (
        shouldRefetch &&
        entry.listeners.size > 0 &&
        entry.queryFn &&
        entry.queryKey !== undefined
      ) {
        refetches.push(
          this.queries.execute({
            cacheMode: entry.cacheMode,
            dedupe: true,
            force: true,
            queryFn: entry.queryFn,
            queryKey: entry.queryKey,
            queryKeyToken: entry.key,
            retry: entry.retry,
            retryDelay: entry.retryDelay,
            select: entry.select,
          })
        );
      }
    }

    if (refetches.length > 0) {
      await Promise.all(refetches);
    }
  }

  async prefetch(executable: AthenaExecutable<unknown>): Promise<void> {
    const descriptor = executable.getDescriptor();
    await this.queries.execute({
      cacheMode: "memory",
      descriptor,
      force: false,
      model: executable.model,
      queryFn: (context) => executable.execute(context),
      queryKey: descriptor.queryKey,
      queryKeyToken: this.getQueryKeyToken(descriptor.queryKey),
    });
  }

  dehydrate(): AthenaDehydratedCache {
    return {
      entities: this.entities.dehydrate(),
      queries: [...this.queries.values()]
        .filter((entry) => entry.queryKey && entry.state.data !== undefined)
        .map((entry) => ({
          data: this.queries.materialize(entry),
          descriptor: entry.descriptor,
          normalizedPage: entry.normalizedPage,
          queryKey: entry.queryKey as QueryKey,
          updatedAt: entry.state.updatedAt,
        })),
    };
  }

  hydrate(state: AthenaDehydratedCache): void {
    this.entities.ingestDehydrated(state.entities);
    for (const query of state.queries) {
      const token = this.getQueryKeyToken(query.queryKey);
      const entry = this.queries.ensure(token);
      entry.queryKey = query.queryKey;
      entry.descriptor = query.descriptor;
      entry.normalizedPage = query.normalizedPage;
      if (query.descriptor) {
        this.graph.indexQuery(token, query.descriptor);
      }
      if (query.normalizedPage) {
        for (const entityToken of query.normalizedPage.entities) {
          this.graph.indexEntity(token, entityToken);
        }
      }
      this.queries.setState(
        entry,
        {
          ...entry.state,
          data: query.data,
          error: null,
          status: "success",
          updatedAt: query.updatedAt ?? Date.now(),
        },
        "query_updated"
      );
    }
  }

  mutateCache(work: (cache: AthenaCacheTransaction) => void): () => void {
    const snapshot = this.dehydrate();
    work(this.createTransactionHandle());
    return () => {
      this.hydrate(snapshot);
    };
  }

  async transaction<T>(
    work: (cache: AthenaCacheTransaction) => Promise<T> | T
  ): Promise<T> {
    const snapshot = {
      entities: this.entities.snapshot(),
      queries: this.queries.snapshot(),
    };
    try {
      return await work(this.createTransactionHandle());
    } catch (error) {
      this.entities.restore(snapshot.entities);
      this.queries.restoreSnapshot(snapshot.queries);
      throw error;
    }
  }

  getEntity<TRow = Record<string, unknown>>(
    key: AthenaEntityKey
  ): TRow | undefined {
    return this.entities.get<TRow>(key);
  }

  reconcileExecutable(
    descriptor: AthenaQueryDescriptor,
    result: unknown,
    model?: AthenaModelTarget
  ): void {
    const resolvedModel = model;
    const rows = extractResultRows(result);
    if (descriptor.operation === "delete") {
      this.reconcileDelete(descriptor, rows, resolvedModel);
      return;
    }
    if (resolvedModel && descriptor.projection?.kind !== "partial-model") {
      for (const row of rows) {
        try {
          const key = createAthenaEntityKey(
            resolvedModel,
            row,
            descriptor.context
          );
          this.writeEntity(key, row, {
            changedFields: descriptor.changedFields,
            mutation: descriptor,
          });
        } catch {
          // Row is not identity-complete; skip graph write.
        }
      }
    }
    if (
      descriptor.operation === "insert" ||
      descriptor.operation === "upsert"
    ) {
      void this.invalidateQueries({
        queryKey: descriptor.modelScopeKey,
        refetch: true,
      });
    }
  }

  forModel<TRow = Record<string, unknown>>(
    model: AthenaModelTarget,
    context?: AthenaCacheContextDescriptor
  ): AthenaModelCache<TRow> {
    const target = resolveAthenaQueryTarget(
      model.meta.tableName ?? model.meta.model ?? "",
      model
    );
    const modelScopeKey = buildAthenaModelScopeKey(target, context);
    return {
      get: (id: unknown) => {
        const key = resolveModelRowKey(model, id, context);
        return this.getEntity<TRow>(key);
      },
      invalidate: () => this.invalidateQueries({ queryKey: modelScopeKey }),
      invalidateEntity: async (id: unknown) => {
        const key = resolveModelRowKey(model, id, context);
        this.removeEntity(key);
        await this.invalidateQueries({ queryKey: modelScopeKey });
      },
      set: (row: TRow) => {
        const key = createAthenaEntityKey(model, row, context);
        this.writeEntity(key, row as Record<string, unknown>, {
          changedFields: Object.keys(row as object),
        });
        return (this.getEntity<TRow>(key) ?? row) as TRow;
      },
      update: (id, updater) => {
        const key = resolveModelRowKey(model, id, context);
        const current = this.getEntity<TRow>(key);
        const next =
          typeof updater === "function"
            ? (updater as (value: TRow | undefined) => TRow)(current)
            : ({ ...(current ?? {}), ...(updater as object) } as TRow);
        const identityRow =
          typeof id === "object" && id !== null
            ? id
            : { [model.meta.primaryKey[0] as string]: id };
        const merged = {
          ...(identityRow as object),
          ...(current as object | undefined),
          ...(next as object),
        } as TRow;
        this.writeEntity(
          createAthenaEntityKey(model, merged, context),
          merged as Record<string, unknown>,
          {
            changedFields:
              typeof updater === "function"
                ? Object.keys(next as object)
                : Object.keys(updater as object),
          }
        );
        return (this.getEntity<TRow>(key) ?? merged) as TRow;
      },
    };
  }

  getMutationKeyToken(mutationKey?: QueryKey): string {
    return this.mutations.token(mutationKey);
  }

  getQueryState<TData = unknown>(key: string) {
    return this.queries.getState<TData>(key);
  }

  getMutationState<TVariables = unknown, TData = unknown>(key: string) {
    return this.mutations.getState<TVariables, TData>(key);
  }

  subscribeQuery(key: string, listener: () => void): AthenaUnsubscribe {
    return this.queries.subscribe(key, listener);
  }

  subscribeMutation(key: string, listener: () => void): AthenaUnsubscribe {
    return this.mutations.subscribe(key, listener);
  }

  subscribeEvents(
    listener: (event: AthenaRuntimeEvent) => void
  ): AthenaUnsubscribe {
    this.eventSubscribers.add(listener);
    return () => {
      this.eventSubscribers.delete(listener);
    };
  }

  attachAdapter(adapter: AthenaStateAdapter): AthenaUnsubscribe {
    this.adapters.add(adapter);
    return () => {
      this.adapters.delete(adapter);
    };
  }

  resetQuery(queryKey: QueryKey): void {
    this.queries.reset(this.getQueryKeyToken(queryKey));
  }

  resetMutation(mutationKey?: QueryKey): void {
    this.mutations.reset(mutationKey);
  }

  executeQuery<TQueryFnData, TData = TQueryFnData>(
    input: ExecuteQueryInput<TQueryFnData, TData>
  ) {
    return this.queries.execute(input);
  }

  executeMutation<TVariables, TMutationFnData, TData = TMutationFnData>(
    input: ExecuteMutationInput<TVariables, TMutationFnData, TData>
  ) {
    return this.mutations.execute(input);
  }

  private writeEntity(
    key: AthenaEntityKey,
    row: Record<string, unknown>,
    options?: {
      changedFields?: readonly string[];
      mutation?: AthenaQueryDescriptor;
    }
  ): void {
    this.entities.merge(key, row);
    const token = athenaEntityKeyToken(key);
    const changedFields = options?.changedFields ?? Object.keys(row);
    const affected = this.collectAffectedQueryEntries(
      key,
      changedFields,
      options?.mutation
    );

    for (const entry of affected) {
      if (!(entry.descriptor && entry.queryKey)) {
        continue;
      }
      if (options?.mutation) {
        if (
          !sameCacheContext(entry.descriptor.context, options.mutation.context)
        ) {
          continue;
        }
        if (queryDependsOnRelationTarget(entry.descriptor, options.mutation)) {
          void this.invalidateQueries({
            exact: true,
            queryKey: entry.queryKey,
          });
          continue;
        }
        if (!sameModelTarget(entry.descriptor, options.mutation)) {
          continue;
        }
        if (
          isCollectionOperation(entry.descriptor.operation) &&
          mutationTouchesQueryMembership(entry.descriptor, changedFields)
        ) {
          void this.invalidateQueries({
            exact: true,
            queryKey: entry.queryKey,
          });
          continue;
        }
      } else if (
        entry.descriptor.target.table === key.model.table &&
        (entry.descriptor.target.schema ?? "") === (key.model.schema ?? "") &&
        isCollectionOperation(entry.descriptor.operation) &&
        mutationTouchesQueryMembership(entry.descriptor, changedFields)
      ) {
        void this.invalidateQueries({
          exact: true,
          queryKey: entry.queryKey,
        });
        continue;
      }

      if (
        entry.entityRefs?.includes(token) ||
        this.resultContainsEntity(entry, key)
      ) {
        this.patchQueryEntryEntity(entry, key);
      }
    }
  }

  private patchQueryEntryEntity(entry: QueryEntry, key: AthenaEntityKey): void {
    if (!entry.queryKey || entry.state.data === undefined) {
      return;
    }
    if (entry.normalizedPage) {
      const next = this.queries.materialize(entry);
      this.queries.setState(
        entry,
        {
          ...entry.state,
          data: next,
          updatedAt: Date.now(),
        },
        "query_updated"
      );
      return;
    }
    const token = athenaEntityKeyToken(key);
    const entity = this.entities.getByToken(token);
    if (!entity) {
      return;
    }
    const next = mapResultRows(entry.state.data, (row) => {
      try {
        if (!entry.model) {
          return row;
        }
        const rowKey = createAthenaEntityKey(
          entry.model,
          row,
          entry.descriptor?.context
        );
        return athenaEntityKeyToken(rowKey) === token
          ? { ...entity.data }
          : row;
      } catch {
        return row;
      }
    });
    this.setQueryData(entry.queryKey, next);
  }

  private resultContainsEntity(
    entry: QueryEntry,
    key: AthenaEntityKey
  ): boolean {
    if (!entry.model || entry.state.data === undefined) {
      return false;
    }
    const token = athenaEntityKeyToken(key);
    return extractResultRows(entry.state.data).some((row) => {
      try {
        return (
          athenaEntityKeyToken(
            createAthenaEntityKey(
              entry.model as AthenaModelTarget,
              row,
              entry.descriptor?.context
            )
          ) === token
        );
      } catch {
        return false;
      }
    });
  }

  private removeEntity(key: AthenaEntityKey): void {
    const token = athenaEntityKeyToken(key);
    this.entities.delete(key);
    for (const entry of [...this.queries.values()]) {
      if (!entry.queryKey) {
        continue;
      }
      if (
        !(
          entry.entityRefs?.includes(token) ||
          this.resultContainsEntity(entry, key)
        )
      ) {
        continue;
      }
      const next = removeResultRows(entry.state.data, (row) => {
        try {
          if (!entry.model) {
            return false;
          }
          return (
            athenaEntityKeyToken(
              createAthenaEntityKey(entry.model, row, entry.descriptor?.context)
            ) === token
          );
        } catch {
          return false;
        }
      });
      entry.entityRefs = entry.entityRefs?.filter((ref) => ref !== token);
      this.setQueryData(entry.queryKey, next);
    }
  }

  private reconcileDelete(
    descriptor: AthenaQueryDescriptor,
    rows: Record<string, unknown>[],
    model?: AthenaModelTarget
  ): void {
    if (model) {
      for (const row of rows) {
        try {
          this.removeEntity(
            createAthenaEntityKey(model, row, descriptor.context)
          );
        } catch {
          // Incomplete identity; skip.
        }
      }
      if (rows.length === 0) {
        const identity = identityRowFromFilters(descriptor, model);
        if (identity) {
          try {
            this.removeEntity(
              createAthenaEntityKey(model, identity, descriptor.context)
            );
          } catch {
            // Incomplete identity; skip.
          }
        }
      }
    }
    void this.invalidateQueries({ queryKey: descriptor.modelScopeKey });
  }

  private collectAffectedQueryEntries(
    key: AthenaEntityKey,
    changedFields: readonly string[],
    mutation?: AthenaQueryDescriptor
  ): QueryEntry[] {
    const ids = this.graph.collectAffectedQueryIds(
      key,
      changedFields,
      mutation
    );
    const entries: QueryEntry[] = [];
    for (const id of ids) {
      const entry = this.queries.get(id);
      if (entry) {
        entries.push(entry);
      }
    }
    if (entries.length === 0) {
      return [...this.queries.values()];
    }
    return entries;
  }

  private createTransactionHandle(): AthenaCacheTransaction {
    return {
      insert: (queryKey, row) => {
        const current = this.getQueryData(queryKey);
        const rows = extractResultRows(current);
        this.setQueryData(
          queryKey,
          Array.isArray(current)
            ? [...rows, row]
            : {
                ...(isPlainResult(current) ? current : {}),
                data: [...rows, row],
              }
        );
      },
      remove: (queryKey, id) => {
        const current = this.getQueryData(queryKey);
        const next = removeResultRows(current, (row) =>
          Object.values(row).some((value) => value === id)
        );
        this.setQueryData(queryKey, next);
      },
      update: (model, id, updater) => {
        this.forModel(model).update(id, updater as never);
      },
    };
  }

  private emitEvent(event: AthenaRuntimeEvent): void {
    for (const listener of this.eventSubscribers) {
      listener(event);
    }

    for (const adapter of this.adapters) {
      adapter.onEvent?.(event);
      if (
        event.type === "query_updated" ||
        event.type === "query_reset" ||
        event.type === "query_gc"
      ) {
        adapter.onQueryUpdated?.(event);
      }
      if (
        event.type === "mutation_updated" ||
        event.type === "mutation_reset"
      ) {
        adapter.onMutationUpdated?.(event);
      }
    }
  }
}

export function createAthenaQueryClient(
  config?: AthenaQueryClientConfig
): AthenaQueryClient {
  return new AthenaQueryClient(config);
}

function isPlainResult(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function identityRowFromFilters(
  descriptor: AthenaQueryDescriptor,
  model: AthenaModelTarget
): Record<string, unknown> | undefined {
  const row: Record<string, unknown> = {};
  for (const column of model.meta.primaryKey) {
    const filter = descriptor.filters?.find(
      (entry) => entry.column === column && entry.operator === "eq"
    );
    if (!filter) {
      return;
    }
    row[column] = filter.value;
  }
  return row;
}

export function attachStateAdapter(
  client: AthenaQueryClient,
  adapter: AthenaStateAdapter
): AthenaUnsubscribe {
  return client.attachAdapter(adapter);
}
