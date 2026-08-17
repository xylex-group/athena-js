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
  describeQueryEnvelope,
  extractResultRows,
  isCollectionOperation,
  mapResultRows,
  materializeNormalizedQueryPage,
  mergeEntityRow,
  type AthenaNormalizedQueryPage,
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
  entityKeyFromSinglePrimary,
} from "../query/model-identity.ts";
import { AthenaQueryGraphIndex } from "../query/query-index.ts";
import type { AthenaModelTarget } from "../schema/types.ts";
import type {
  AthenaCacheMode,
  AthenaInvalidateQueriesFilters,
  AthenaMutationDefaults,
  AthenaMutationEvent,
  AthenaMutationRequestLog,
  AthenaMutationResultData,
  AthenaMutationState,
  AthenaQueryClientConfig,
  AthenaQueryDefaults,
  AthenaQueryEvent,
  AthenaQueryRequestLog,
  AthenaQueryResult,
  AthenaQueryState,
  AthenaRuntimeEvent,
  AthenaStateAdapter,
  AthenaUnsubscribe,
  QueryKey,
} from "./types.ts";
import {
  matchesQueryKey,
  normalizeAthenaError,
  normalizeAthenaResult,
  runWithRetry,
  safeSerializeQueryKey,
} from "./utils.ts";

interface ExecuteQueryInput<TQueryFnData, TData> {
  cacheMode?: AthenaCacheMode;
  dedupe?: boolean;
  descriptor?: AthenaQueryDescriptor;
  force?: boolean;
  model?: AthenaModelTarget;
  queryFn: (context?: { signal?: AbortSignal }) => Promise<TQueryFnData>;
  signal?: AbortSignal;
  queryKey: QueryKey;
  queryKeyToken: string;
  retry?: number | false;
  retryDelay?: number | ((attempt: number) => number);
  select?: (data: TQueryFnData) => TData;
}

interface ExecuteMutationInput<TVariables, TMutationFnData, TData> {
  mutationFn: (variables: TVariables) => Promise<TMutationFnData>;
  mutationKey?: QueryKey;
  mutationKeyToken: string;
  retry?: number | false;
  retryDelay?: number | ((attempt: number) => number);
  select?: (data: TMutationFnData) => TData;
  variables: TVariables;
}

interface QueryEntry {
  activeRequestId: number;
  cacheMode?: AthenaCacheMode;
  descriptor?: AthenaQueryDescriptor;
  entityRefs?: string[];
  gcTimer?: ReturnType<typeof setTimeout>;
  normalizedPage?: AthenaNormalizedQueryPage;
  key: string;
  listeners: Set<() => void>;
  model?: AthenaModelTarget;
  queryFn?: (context?: { signal?: AbortSignal }) => Promise<unknown>;
  queryKey?: QueryKey;
  retry?: number | false;
  retryDelay?: number | ((attempt: number) => number);
  select?: (data: unknown) => unknown;
  state: AthenaQueryState<unknown>;
}

interface MutationEntry {
  activeRequestId: number;
  gcTimer?: ReturnType<typeof setTimeout>;
  key: string;
  listeners: Set<() => void>;
  state: AthenaMutationState<unknown, unknown>;
}

function createInitialQueryState<TData>(
  initialData?: TData
): AthenaQueryState<TData> {
  return {
    data: initialData,
    error: null,
    isFetching: false,
    status: initialData === undefined ? "idle" : "success",
    updatedAt: initialData === undefined ? undefined : Date.now(),
  };
}

function createInitialMutationState<TVariables, TData>(): AthenaMutationState<
  TVariables,
  TData
> {
  return {
    data: undefined,
    error: null,
    isLoading: false,
    lastResponse: undefined,
    lastVariables: undefined,
    status: "idle",
    updatedAt: undefined,
  };
}

function shouldUseMemoryCache(
  config: AthenaQueryClientConfig,
  override?: AthenaCacheMode
): boolean {
  return (override ?? config.cache?.mode) === "memory";
}

export interface AthenaCacheTransaction {
  insert(queryKey: QueryKey, row: Record<string, unknown>): void;
  remove(queryKey: QueryKey, id: unknown): void;
  update(
    model: AthenaModelTarget,
    id: unknown,
    updater:
      | Record<string, unknown>
      | ((current: Record<string, unknown> | undefined) => Record<string, unknown>)
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

interface EntityEntry {
  data: Record<string, unknown>;
  key: AthenaEntityKey;
  updatedAt: number;
}

export class AthenaQueryClient {
  private readonly queryEntries = new Map<string, QueryEntry>();
  private readonly mutationEntries = new Map<string, MutationEntry>();
  private readonly entityEntries = new Map<string, EntityEntry>();
  private readonly graphIndex = new AthenaQueryGraphIndex();
  private readonly inflightQueries = new Map<
    string,
    Promise<AthenaQueryResult<unknown>>
  >();
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
    const token = this.getQueryKeyToken(queryKey);
    const entry = this.queryEntries.get(token);
    if (!entry) {
      return;
    }
    return this.materializeEntry(entry) as TData | undefined;
  }

  getNormalizedQueryPage(
    queryKey: QueryKey
  ): AthenaNormalizedQueryPage | undefined {
    return this.queryEntries.get(this.getQueryKeyToken(queryKey))
      ?.normalizedPage;
  }

  setQueryData<TData>(
    queryKey: QueryKey,
    updater: TData | ((previous: TData | undefined) => TData)
  ): TData {
    const token = this.getQueryKeyToken(queryKey);
    const entry = this.ensureQueryEntry(token);
    entry.queryKey = queryKey;
    entry.normalizedPage = undefined;
    entry.activeRequestId = ++this.requestCounter;
    const previous = this.materializeEntry(entry) as TData | undefined;
    const next =
      typeof updater === "function"
        ? (updater as (value: TData | undefined) => TData)(previous)
        : updater;
    const finishedAt = Date.now();
    this.setQueryState(
      entry,
      {
        ...entry.state,
        data: next,
        error: null,
        status: "success",
        updatedAt: finishedAt,
      },
      "query_updated"
    );
    return next;
  }

  async invalidateQueries(
    filters: AthenaInvalidateQueriesFilters = {}
  ): Promise<void> {
    const exact = filters.exact === true;
    const shouldRefetch = filters.refetch !== false;
    const matched: QueryEntry[] = [];

    for (const entry of this.queryEntries.values()) {
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
      this.setQueryState(
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
          this.executeQuery({
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
    await this.executeQuery({
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
      entities: [...this.entityEntries.entries()].map(([token, entry]) => ({
        data: entry.data,
        token,
      })),
      queries: [...this.queryEntries.values()]
        .filter((entry) => entry.queryKey && entry.state.data !== undefined)
        .map((entry) => ({
          data: this.materializeEntry(entry),
          descriptor: entry.descriptor,
          normalizedPage: entry.normalizedPage,
          queryKey: entry.queryKey as QueryKey,
          updatedAt: entry.state.updatedAt,
        })),
    };
  }

  hydrate(state: AthenaDehydratedCache): void {
    for (const entity of state.entities) {
      this.entityEntries.set(entity.token, {
        data: entity.data,
        key: {
          context: null,
          model: { table: "" },
          primaryKey: [],
        },
        updatedAt: Date.now(),
      });
    }
    for (const query of state.queries) {
      const token = this.getQueryKeyToken(query.queryKey);
      const entry = this.ensureQueryEntry(token);
      entry.queryKey = query.queryKey;
      entry.descriptor = query.descriptor;
      entry.normalizedPage = query.normalizedPage;
      if (query.descriptor) {
        this.graphIndex.indexQuery(token, query.descriptor);
      }
      if (query.normalizedPage) {
        for (const entityToken of query.normalizedPage.entities) {
          this.graphIndex.indexEntity(token, entityToken);
        }
      }
      this.setQueryState(
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
    const snapshot = this.snapshotCache();
    try {
      return await work(this.createTransactionHandle());
    } catch (error) {
      this.restoreSnapshot(snapshot);
      throw error;
    }
  }

  getEntity<TRow = Record<string, unknown>>(
    key: AthenaEntityKey
  ): TRow | undefined {
    return this.entityEntries.get(athenaEntityKeyToken(key))?.data as
      | TRow
      | undefined;
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
    if (mutationKey === undefined || mutationKey === null) {
      return "__mutation__default__";
    }
    return safeSerializeQueryKey(mutationKey as QueryKey);
  }

  getQueryState<TData = unknown>(key: string): AthenaQueryState<TData> {
    const entry = this.ensureQueryEntry(key);
    return entry.state as AthenaQueryState<TData>;
  }

  getMutationState<TVariables = unknown, TData = unknown>(
    key: string
  ): AthenaMutationState<TVariables, TData> {
    const entry = this.ensureMutationEntry(key);
    return entry.state as AthenaMutationState<TVariables, TData>;
  }

  subscribeQuery(key: string, listener: () => void): AthenaUnsubscribe {
    const entry = this.ensureQueryEntry(key);
    if (entry.gcTimer) {
      clearTimeout(entry.gcTimer);
      entry.gcTimer = undefined;
    }
    entry.listeners.add(listener);
    return () => {
      const current = this.queryEntries.get(key);
      if (!current) {
        return;
      }
      current.listeners.delete(listener);
      if (current.listeners.size === 0) {
        this.scheduleQueryGc(current);
      }
    };
  }

  subscribeMutation(key: string, listener: () => void): AthenaUnsubscribe {
    const entry = this.ensureMutationEntry(key);
    if (entry.gcTimer) {
      clearTimeout(entry.gcTimer);
      entry.gcTimer = undefined;
    }
    entry.listeners.add(listener);
    return () => {
      const current = this.mutationEntries.get(key);
      if (!current) {
        return;
      }
      current.listeners.delete(listener);
      if (current.listeners.size === 0) {
        this.scheduleMutationGc(current);
      }
    };
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
    const key = this.getQueryKeyToken(queryKey);
    const entry = this.ensureQueryEntry(key);
    entry.activeRequestId = ++this.requestCounter;
    this.setQueryState(entry, createInitialQueryState(), "query_reset");
    this.inflightQueries.delete(key);
  }

  resetMutation(mutationKey?: QueryKey): void {
    const key = this.getMutationKeyToken(mutationKey);
    const entry = this.ensureMutationEntry(key);
    entry.activeRequestId = ++this.requestCounter;
    this.setMutationState(
      entry,
      createInitialMutationState(),
      "mutation_reset"
    );
  }

  async executeQuery<TQueryFnData, TData = TQueryFnData>(
    input: ExecuteQueryInput<TQueryFnData, TData>
  ): Promise<AthenaQueryResult<TData>> {
    const entry = this.ensureQueryEntry(input.queryKeyToken);
    entry.queryKey = input.queryKey;
    entry.queryFn = input.queryFn;
    entry.retry = input.retry;
    entry.retryDelay = input.retryDelay;
    entry.select = input.select as ((data: unknown) => unknown) | undefined;
    if (input.cacheMode !== undefined) {
      entry.cacheMode = input.cacheMode;
    }
    if (input.descriptor) {
      if (entry.descriptor) {
        this.graphIndex.unindexQuery(entry.key, entry.descriptor, entry.entityRefs);
      }
      entry.descriptor = input.descriptor;
      this.graphIndex.indexQuery(entry.key, input.descriptor);
    }
    if (input.model) {
      entry.model = input.model;
    }

    if (input.dedupe !== false) {
      const existing = this.inflightQueries.get(input.queryKeyToken);
      if (existing) {
        return existing as Promise<AthenaQueryResult<TData>>;
      }
    }

    if (
      !input.force &&
      shouldUseMemoryCache(this.config, input.cacheMode ?? entry.cacheMode)
    ) {
      const staleTime = this.config.cache?.staleTime ?? 0;
      const hasFreshData =
        entry.state.status === "success" &&
        entry.state.data !== undefined &&
        entry.state.updatedAt !== undefined &&
        Date.now() - entry.state.updatedAt <= staleTime;
      if (hasFreshData) {
        return {
          __applied: true,
          data: entry.state.data as TData,
          error: null,
          raw: entry.state.lastResponse ?? entry.state.data,
          status: 200,
        } as AthenaQueryResult<TData>;
      }
    }

    const requestId = ++this.requestCounter;
    entry.activeRequestId = requestId;

    const startRequestLog: AthenaQueryRequestLog = {
      attempt: 1,
      queryKey: input.queryKey,
      queryKeyToken: input.queryKeyToken,
      requestId,
      startedAt: Date.now(),
    };

    const loadingStatus =
      entry.state.data === undefined ? "loading" : entry.state.status;
    this.setQueryState(
      entry,
      {
        ...entry.state,
        error: null,
        isFetching: true,
        lastRequest: startRequestLog,
        status: loadingStatus,
      },
      "query_updated"
    );

    const executionPromise = runWithRetry(
      async (attempt) => {
        const attemptRequestLog: AthenaQueryRequestLog = {
          ...startRequestLog,
          attempt,
        };

        if (entry.activeRequestId === requestId) {
          this.setQueryState(
            entry,
            {
              ...entry.state,
              isFetching: true,
              lastRequest: attemptRequestLog,
            },
            "query_updated"
          );
        }

        const rawResult = await input.queryFn(
          input.signal ? { signal: input.signal } : undefined
        );
        const normalized = normalizeAthenaResult<TQueryFnData, TData>(
          rawResult,
          input.select
        );

        if (normalized.error) {
          // Internal transport object for retry/normalize path (not a public Error).
          // biome-ignore lint/style/useThrowOnlyError: structured control-flow payload
          throw {
            __athenaNormalizedError: normalized.error,
            __athenaRaw: normalized.raw,
            __athenaResponse: rawResult,
            __athenaStatus: normalized.status,
          };
        }

        return {
          attempt,
          normalized,
          response: rawResult,
        };
      },
      {
        retry: input.retry,
        retryDelay: input.retryDelay,
      }
    )
      .then((result) => {
        const applied = entry.activeRequestId === requestId;
        if (applied) {
          const finishedAt = Date.now();
          const doneRequestLog: AthenaQueryRequestLog = {
            ...startRequestLog,
            attempt: result.attempt,
            endedAt: finishedAt,
          };
          const data = this.ingestQueryResult(entry, result.normalized.data);
          this.setQueryState(
            entry,
            {
              ...entry.state,
              data,
              error: null,
              isFetching: false,
              lastRequest: doneRequestLog,
              lastResponse: result.response,
              status: "success",
              updatedAt: finishedAt,
            },
            "query_updated"
          );
        }

        return {
          ...result.normalized,
          __applied: applied,
        } as AthenaQueryResult<TData>;
      })
      .catch((error) => {
        const wrapped =
          typeof error === "object" && error !== null
            ? (error as Record<string, unknown>)
            : undefined;

        const normalizedError = wrapped?.__athenaNormalizedError
          ? (wrapped.__athenaNormalizedError as ReturnType<
              typeof normalizeAthenaError
            >)
          : normalizeAthenaError(error);

        const status =
          typeof wrapped?.__athenaStatus === "number"
            ? (wrapped.__athenaStatus as number)
            : (normalizedError.status ?? 500);

        const raw = wrapped?.__athenaRaw ?? normalizedError.raw ?? null;
        const response = wrapped?.__athenaResponse ?? raw;

        const applied = entry.activeRequestId === requestId;
        if (applied) {
          const finishedAt = Date.now();
          const doneRequestLog: AthenaQueryRequestLog = {
            ...startRequestLog,
            attempt:
              entry.state.lastRequest?.requestId === requestId
                ? entry.state.lastRequest.attempt
                : startRequestLog.attempt,
            endedAt: finishedAt,
          };
          this.setQueryState(
            entry,
            {
              ...entry.state,
              error: normalizedError,
              isFetching: false,
              lastRequest: doneRequestLog,
              lastResponse: response,
              status: "error",
              updatedAt: finishedAt,
            },
            "query_updated"
          );
        }

        return {
          __applied: applied,
          data: undefined,
          error: normalizedError,
          raw,
          status,
        } as AthenaQueryResult<TData>;
      })
      .finally(() => {
        const inflight = this.inflightQueries.get(input.queryKeyToken);
        if (inflight === executionPromise) {
          this.inflightQueries.delete(input.queryKeyToken);
        }
      });

    this.inflightQueries.set(
      input.queryKeyToken,
      executionPromise as Promise<AthenaQueryResult<unknown>>
    );

    return executionPromise;
  }

  async executeMutation<TVariables, TMutationFnData, TData = TMutationFnData>(
    input: ExecuteMutationInput<TVariables, TMutationFnData, TData>
  ): Promise<AthenaMutationResultData<TData>> {
    const entry = this.ensureMutationEntry(input.mutationKeyToken);
    const requestId = ++this.requestCounter;
    entry.activeRequestId = requestId;

    const startRequestLog: AthenaMutationRequestLog<TVariables> = {
      attempt: 1,
      mutationKey: input.mutationKey,
      mutationKeyToken: input.mutationKeyToken,
      requestId,
      startedAt: Date.now(),
      variables: input.variables,
    };

    this.setMutationState(
      entry,
      {
        ...entry.state,
        error: null,
        isLoading: true,
        lastRequest: startRequestLog,
        lastVariables: input.variables,
        status: "loading",
      },
      "mutation_updated"
    );

    try {
      const result = await runWithRetry(
        async (attempt) => {
          const attemptRequestLog: AthenaMutationRequestLog<TVariables> = {
            ...startRequestLog,
            attempt,
          };

          if (entry.activeRequestId === requestId) {
            this.setMutationState(
              entry,
              {
                ...entry.state,
                isLoading: true,
                lastRequest: attemptRequestLog,
              },
              "mutation_updated"
            );
          }

          const rawResult = await input.mutationFn(input.variables);
          const normalized = normalizeAthenaResult<TMutationFnData, TData>(
            rawResult,
            input.select
          );
          if (normalized.error) {
            // Internal transport object for retry/normalize path (not a public Error).
            // biome-ignore lint/style/useThrowOnlyError: structured control-flow payload
            throw {
              __athenaNormalizedError: normalized.error,
              __athenaRaw: normalized.raw,
              __athenaResponse: rawResult,
              __athenaStatus: normalized.status,
            };
          }

          return {
            attempt,
            normalized,
            response: rawResult,
          };
        },
        {
          retry: input.retry,
          retryDelay: input.retryDelay,
        }
      );

      if (entry.activeRequestId === requestId) {
        const finishedAt = Date.now();
        const doneRequestLog: AthenaMutationRequestLog<TVariables> = {
          ...startRequestLog,
          attempt: result.attempt,
          endedAt: finishedAt,
        };
        this.setMutationState(
          entry,
          {
            ...entry.state,
            data: result.normalized.data,
            error: null,
            isLoading: false,
            lastRequest: doneRequestLog,
            lastResponse: result.response,
            lastVariables: input.variables,
            status: "success",
            updatedAt: finishedAt,
          },
          "mutation_updated"
        );
      }

      return result.normalized;
    } catch (error) {
      const wrapped =
        typeof error === "object" && error !== null
          ? (error as Record<string, unknown>)
          : undefined;
      const normalizedError = wrapped?.__athenaNormalizedError
        ? (wrapped.__athenaNormalizedError as ReturnType<
            typeof normalizeAthenaError
          >)
        : normalizeAthenaError(error);

      const status =
        typeof wrapped?.__athenaStatus === "number"
          ? (wrapped.__athenaStatus as number)
          : (normalizedError.status ?? 500);
      const raw = wrapped?.__athenaRaw ?? normalizedError.raw ?? null;
      const response = wrapped?.__athenaResponse ?? raw;

      if (entry.activeRequestId === requestId) {
        const finishedAt = Date.now();
        const doneRequestLog: AthenaMutationRequestLog<TVariables> = {
          ...startRequestLog,
          attempt:
            entry.state.lastRequest?.requestId === requestId
              ? entry.state.lastRequest.attempt
              : startRequestLog.attempt,
          endedAt: finishedAt,
        };

        this.setMutationState(
          entry,
          {
            ...entry.state,
            error: normalizedError,
            isLoading: false,
            lastRequest: doneRequestLog,
            lastResponse: response,
            lastVariables: input.variables,
            status: "error",
            updatedAt: finishedAt,
          },
          "mutation_updated"
        );
      }

      return {
        data: undefined,
        error: normalizedError,
        raw,
        status,
      };
    }
  }

  private ensureQueryEntry(key: string): QueryEntry {
    let entry = this.queryEntries.get(key);
    if (entry) {
      return entry;
    }

    entry = {
      activeRequestId: 0,
      key,
      listeners: new Set(),
      state: createInitialQueryState(),
    };
    this.queryEntries.set(key, entry);
    return entry;
  }

  private ensureMutationEntry(key: string): MutationEntry {
    let entry = this.mutationEntries.get(key);
    if (entry) {
      return entry;
    }

    entry = {
      activeRequestId: 0,
      key,
      listeners: new Set(),
      state: createInitialMutationState(),
    };
    this.mutationEntries.set(key, entry);
    return entry;
  }

  private scheduleQueryGc(entry: QueryEntry): void {
    const gcTime = shouldUseMemoryCache(this.config)
      ? Math.max(0, this.config.cache?.gcTime ?? 300_000)
      : Math.max(0, this.config.cache?.gcTime ?? 0);

    entry.gcTimer = setTimeout(() => {
      const current = this.queryEntries.get(entry.key);
      if (!current || current.listeners.size > 0) {
        return;
      }
      this.graphIndex.unindexQuery(
        entry.key,
        current.descriptor,
        current.entityRefs
      );
      this.queryEntries.delete(entry.key);
      this.inflightQueries.delete(entry.key);
      this.emitEvent({
        key: entry.key,
        state: current.state,
        timestamp: Date.now(),
        type: "query_gc",
      });
    }, gcTime);
  }

  private scheduleMutationGc(entry: MutationEntry): void {
    const gcTime = shouldUseMemoryCache(this.config)
      ? Math.max(0, this.config.cache?.gcTime ?? 300_000)
      : Math.max(0, this.config.cache?.gcTime ?? 0);

    entry.gcTimer = setTimeout(() => {
      const current = this.mutationEntries.get(entry.key);
      if (!current || current.listeners.size > 0) {
        return;
      }
      this.mutationEntries.delete(entry.key);
    }, gcTime);
  }

  private setQueryState(
    entry: QueryEntry,
    state: AthenaQueryState<unknown>,
    eventType: AthenaQueryEvent["type"]
  ): void {
    entry.state = state;
    for (const listener of entry.listeners) {
      listener();
    }

    this.emitEvent({
      key: entry.key,
      state,
      timestamp: Date.now(),
      type: eventType,
    });
  }

  private setMutationState(
    entry: MutationEntry,
    state: AthenaMutationState<unknown, unknown>,
    eventType: AthenaMutationEvent["type"]
  ): void {
    entry.state = state;
    for (const listener of entry.listeners) {
      listener();
    }

    this.emitEvent({
      key: entry.key,
      state,
      timestamp: Date.now(),
      type: eventType,
    });
  }

  private ingestQueryResult(entry: QueryEntry, data: unknown): unknown {
    if (
      !(
        entry.descriptor &&
        entry.model &&
        entry.descriptor.projection?.kind === "full-model"
      )
    ) {
      entry.entityRefs = undefined;
      entry.normalizedPage = undefined;
      return data;
    }

    const refs: string[] = [];
    for (const row of extractResultRows(data)) {
      try {
        const key = createAthenaEntityKey(
          entry.model as AthenaModelTarget,
          row,
          entry.descriptor?.context
        );
        const token = athenaEntityKeyToken(key);
        this.mergeEntityNode(key, row);
        refs.push(token);
      } catch {
        // Row is not identity-complete; skip graph write.
      }
    }
    if (entry.entityRefs) {
      this.graphIndex.unindexQuery(entry.key, undefined, entry.entityRefs);
    }
    entry.entityRefs = refs;
    const envelope = describeQueryEnvelope(data);
    entry.normalizedPage = {
      entities: refs,
      envelope: envelope.envelope,
      extras: envelope.extras,
    };
    for (const token of refs) {
      this.graphIndex.indexEntity(entry.key, token);
    }
    return this.materializeEntry(entry) ?? data;
  }

  private materializeEntry(entry: QueryEntry): unknown {
    if (!entry.normalizedPage) {
      return entry.state.data;
    }
    return materializeNormalizedQueryPage(entry.normalizedPage, (token) =>
      this.entityEntries.get(token)?.data
    );
  }

  private mergeEntityNode(
    key: AthenaEntityKey,
    row: Record<string, unknown>
  ): void {
    const token = athenaEntityKeyToken(key);
    const current = this.entityEntries.get(token);
    this.entityEntries.set(token, {
      data: mergeEntityRow(current?.data, row),
      key,
      updatedAt: Date.now(),
    });
  }

  private writeEntity(
    key: AthenaEntityKey,
    row: Record<string, unknown>,
    options?: {
      changedFields?: readonly string[];
      mutation?: AthenaQueryDescriptor;
    }
  ): void {
    this.mergeEntityNode(key, row);
    const token = athenaEntityKeyToken(key);
    const changedFields = options?.changedFields ?? Object.keys(row);
    const affected = this.collectAffectedQueryEntries(key, changedFields, options?.mutation);

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
      const next = this.materializeEntry(entry);
      this.setQueryState(
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
    const entity = this.entityEntries.get(token);
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
    this.entityEntries.delete(token);
    for (const entry of [...this.queryEntries.values()]) {
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
    const ids = new Set<string>();
    const token = athenaEntityKeyToken(key);
    for (const queryId of this.graphIndex.queriesForEntity(token)) {
      ids.add(queryId);
    }
    for (const queryId of this.graphIndex.queriesForModel({
      database: key.model.database,
      schema: key.model.schema,
      table: key.model.table,
    })) {
      ids.add(queryId);
    }
    for (const field of changedFields) {
      for (const queryId of this.graphIndex.queriesForField(
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
      for (const queryId of this.graphIndex.byModel.get(
        `::${mutation.target.model}`
      ) ?? []) {
        ids.add(queryId);
      }
    }

    const entries: QueryEntry[] = [];
    for (const id of ids) {
      const entry = this.queryEntries.get(id);
      if (entry) {
        entries.push(entry);
      }
    }
    if (entries.length === 0) {
      return [...this.queryEntries.values()];
    }
    return entries;
  }

  private snapshotCache() {
    return {
      entities: new Map(this.entityEntries),
      queries: new Map(
        [...this.queryEntries.entries()].map(([token, entry]) => [
          token,
          {
            data: entry.state.data,
            descriptor: entry.descriptor,
            entityRefs: entry.entityRefs ? [...entry.entityRefs] : undefined,
            queryKey: entry.queryKey,
            updatedAt: entry.state.updatedAt,
          },
        ])
      ),
    };
  }

  private restoreSnapshot(
    snapshot: ReturnType<AthenaQueryClient["snapshotCache"]>
  ): void {
    this.entityEntries.clear();
    for (const [token, entry] of snapshot.entities) {
      this.entityEntries.set(token, entry);
    }
    for (const [token, snap] of snapshot.queries) {
      const entry = this.ensureQueryEntry(token);
      entry.descriptor = snap.descriptor;
      entry.entityRefs = snap.entityRefs;
      entry.queryKey = snap.queryKey;
      this.setQueryState(
        entry,
        {
          ...entry.state,
          data: snap.data,
          updatedAt: snap.updatedAt,
        },
        "query_updated"
      );
    }
  }

  private createTransactionHandle(): AthenaCacheTransaction {
    return {
      insert: (queryKey, row) => {
        const current = this.getQueryData(queryKey);
        const rows = extractResultRows(current);
        this.setQueryData(queryKey, Array.isArray(current)
          ? [...rows, row]
          : { ...(isPlainResult(current) ? current : {}), data: [...rows, row] });
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

function resolveModelRowKey(
  model: AthenaModelTarget,
  id: unknown,
  context?: AthenaCacheContextDescriptor
): AthenaEntityKey {
  if (typeof id === "object" && id !== null) {
    return createAthenaEntityKey(model, id, context);
  }
  return entityKeyFromSinglePrimary(model, id, context);
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
