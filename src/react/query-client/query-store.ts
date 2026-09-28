import type { AthenaQueryDescriptor } from "../../query/descriptor.ts";
import {
  type AthenaNormalizedQueryPage,
  describeQueryEnvelope,
  extractResultRows,
  materializeNormalizedQueryPage,
} from "../../query/entity-graph.ts";
import {
  athenaEntityKeyToken,
  createAthenaEntityKey,
} from "../../query/model-identity.ts";
import type { AthenaModelTarget } from "../../schema/types.ts";
import type {
  AthenaCacheMode,
  AthenaQueryClientConfig,
  AthenaQueryEvent,
  AthenaQueryRequestLog,
  AthenaQueryResult,
  AthenaQueryState,
  AthenaRuntimeEvent,
  AthenaUnsubscribe,
  QueryKey,
} from "../types.ts";
import {
  normalizeAthenaError,
  normalizeAthenaResult,
  runWithRetry,
} from "../utils.ts";
import type { EntityStore } from "./entity-store.ts";
import type { QueryClientGraphIndex } from "./graph-index.ts";

export interface ExecuteQueryInput<TQueryFnData, TData> {
  cacheMode?: AthenaCacheMode;
  dedupe?: boolean;
  descriptor?: AthenaQueryDescriptor;
  force?: boolean;
  model?: AthenaModelTarget;
  queryFn: (context?: { signal?: AbortSignal }) => Promise<TQueryFnData>;
  queryKey: QueryKey;
  queryKeyToken: string;
  retry?: number | false;
  retryDelay?: number | ((attempt: number) => number);
  select?: (data: TQueryFnData) => TData;
  signal?: AbortSignal;
}

export interface QueryEntry {
  activeRequestId: number;
  cacheMode?: AthenaCacheMode;
  descriptor?: AthenaQueryDescriptor;
  entityRefs?: string[];
  gcTimer?: ReturnType<typeof setTimeout>;
  key: string;
  listeners: Set<() => void>;
  model?: AthenaModelTarget;
  normalizedPage?: AthenaNormalizedQueryPage;
  queryFn?: (context?: { signal?: AbortSignal }) => Promise<unknown>;
  queryKey?: QueryKey;
  retry?: number | false;
  retryDelay?: number | ((attempt: number) => number);
  select?: (data: unknown) => unknown;
  state: AthenaQueryState<unknown>;
}

export interface QueryStoreHost {
  config: AthenaQueryClientConfig;
  emitEvent(event: AthenaRuntimeEvent): void;
  entities: EntityStore;
  graph: QueryClientGraphIndex;
  nextRequestId(): number;
}

export function createInitialQueryState<TData>(
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

export function shouldUseMemoryCache(
  config: AthenaQueryClientConfig,
  override?: AthenaCacheMode
): boolean {
  return (override ?? config.cache?.mode) === "memory";
}

export class QueryStore {
  private readonly entries = new Map<string, QueryEntry>();
  private readonly inflight = new Map<
    string,
    Promise<AthenaQueryResult<unknown>>
  >();

  constructor(private readonly host: QueryStoreHost) {}

  get(key: string): QueryEntry | undefined {
    return this.entries.get(key);
  }

  values(): IterableIterator<QueryEntry> {
    return this.entries.values();
  }

  ensure(key: string): QueryEntry {
    let entry = this.entries.get(key);
    if (entry) {
      return entry;
    }

    entry = {
      activeRequestId: 0,
      key,
      listeners: new Set(),
      state: createInitialQueryState(),
    };
    this.entries.set(key, entry);
    return entry;
  }

  getQueryData<TData = unknown>(queryKeyToken: string): TData | undefined {
    const entry = this.entries.get(queryKeyToken);
    if (!entry) {
      return;
    }
    return this.materialize(entry) as TData | undefined;
  }

  getNormalizedPage(
    queryKeyToken: string
  ): AthenaNormalizedQueryPage | undefined {
    return this.entries.get(queryKeyToken)?.normalizedPage;
  }

  getState<TData = unknown>(key: string): AthenaQueryState<TData> {
    return this.ensure(key).state as AthenaQueryState<TData>;
  }

  setQueryData<TData>(
    queryKey: QueryKey,
    queryKeyToken: string,
    updater: TData | ((previous: TData | undefined) => TData)
  ): TData {
    const entry = this.ensure(queryKeyToken);
    entry.queryKey = queryKey;
    entry.normalizedPage = undefined;
    entry.activeRequestId = this.host.nextRequestId();
    const previous = this.materialize(entry) as TData | undefined;
    const next =
      typeof updater === "function"
        ? (updater as (value: TData | undefined) => TData)(previous)
        : updater;
    const finishedAt = Date.now();
    this.setState(
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

  subscribe(key: string, listener: () => void): AthenaUnsubscribe {
    const entry = this.ensure(key);
    if (entry.gcTimer) {
      clearTimeout(entry.gcTimer);
      entry.gcTimer = undefined;
    }
    entry.listeners.add(listener);
    return () => {
      const current = this.entries.get(key);
      if (!current) {
        return;
      }
      current.listeners.delete(listener);
      if (current.listeners.size === 0) {
        this.scheduleGc(current);
      }
    };
  }

  reset(queryKeyToken: string): void {
    const entry = this.ensure(queryKeyToken);
    entry.activeRequestId = this.host.nextRequestId();
    this.setState(entry, createInitialQueryState(), "query_reset");
    this.inflight.delete(queryKeyToken);
  }

  setState(
    entry: QueryEntry,
    state: AthenaQueryState<unknown>,
    eventType: AthenaQueryEvent["type"]
  ): void {
    entry.state = state;
    for (const listener of entry.listeners) {
      listener();
    }

    this.host.emitEvent({
      key: entry.key,
      state,
      timestamp: Date.now(),
      type: eventType,
    });
  }

  materialize(entry: QueryEntry): unknown {
    if (!entry.normalizedPage) {
      return entry.state.data;
    }
    return materializeNormalizedQueryPage(
      entry.normalizedPage,
      (token) => this.host.entities.getByToken(token)?.data
    );
  }

  ingestResult(entry: QueryEntry, data: unknown): unknown {
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
        this.host.entities.merge(key, row);
        refs.push(token);
      } catch {
        // Row is not identity-complete; skip graph write.
      }
    }
    if (entry.entityRefs) {
      this.host.graph.unindexQuery(entry.key, undefined, entry.entityRefs);
    }
    entry.entityRefs = refs;
    const envelope = describeQueryEnvelope(data);
    entry.normalizedPage = {
      entities: refs,
      envelope: envelope.envelope,
      extras: envelope.extras,
    };
    for (const token of refs) {
      this.host.graph.indexEntity(entry.key, token);
    }
    return this.materialize(entry) ?? data;
  }

  async execute<TQueryFnData, TData = TQueryFnData>(
    input: ExecuteQueryInput<TQueryFnData, TData>
  ): Promise<AthenaQueryResult<TData>> {
    const entry = this.ensure(input.queryKeyToken);
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
        this.host.graph.unindexQuery(
          entry.key,
          entry.descriptor,
          entry.entityRefs
        );
      }
      entry.descriptor = input.descriptor;
      this.host.graph.indexQuery(entry.key, input.descriptor);
    }
    if (input.model) {
      entry.model = input.model;
    }

    if (input.dedupe !== false) {
      const existing = this.inflight.get(input.queryKeyToken);
      if (existing) {
        return existing as Promise<AthenaQueryResult<TData>>;
      }
    }

    if (
      !input.force &&
      shouldUseMemoryCache(this.host.config, input.cacheMode ?? entry.cacheMode)
    ) {
      const staleTime = this.host.config.cache?.staleTime ?? 0;
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

    const requestId = this.host.nextRequestId();
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
    this.setState(
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
          this.setState(
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
          throw Object.assign(new Error("athena.query.normalized"), {
            __athenaNormalizedError: normalized.error,
            __athenaRaw: normalized.raw,
            __athenaResponse: rawResult,
            __athenaStatus: normalized.status,
          });
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
          const data = this.ingestResult(entry, result.normalized.data);
          this.setState(
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
          this.setState(
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
        const inflight = this.inflight.get(input.queryKeyToken);
        if (inflight === executionPromise) {
          this.inflight.delete(input.queryKeyToken);
        }
      });

    this.inflight.set(
      input.queryKeyToken,
      executionPromise as Promise<AthenaQueryResult<unknown>>
    );

    return executionPromise;
  }

  snapshot(): Map<
    string,
    {
      data: unknown;
      descriptor?: AthenaQueryDescriptor;
      entityRefs?: string[];
      queryKey?: QueryKey;
      updatedAt?: number;
    }
  > {
    return new Map(
      [...this.entries.entries()].map(([token, entry]) => [
        token,
        {
          data: entry.state.data,
          descriptor: entry.descriptor,
          entityRefs: entry.entityRefs ? [...entry.entityRefs] : undefined,
          queryKey: entry.queryKey,
          updatedAt: entry.state.updatedAt,
        },
      ])
    );
  }

  restoreSnapshot(snapshot: ReturnType<QueryStore["snapshot"]>): void {
    for (const [token, snap] of snapshot) {
      const entry = this.ensure(token);
      entry.descriptor = snap.descriptor;
      entry.entityRefs = snap.entityRefs;
      entry.queryKey = snap.queryKey;
      this.setState(
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

  private scheduleGc(entry: QueryEntry): void {
    const gcTime = shouldUseMemoryCache(this.host.config)
      ? Math.max(0, this.host.config.cache?.gcTime ?? 300_000)
      : Math.max(0, this.host.config.cache?.gcTime ?? 0);

    entry.gcTimer = setTimeout(() => {
      const current = this.entries.get(entry.key);
      if (!current || current.listeners.size > 0) {
        return;
      }
      this.host.graph.unindexQuery(
        entry.key,
        current.descriptor,
        current.entityRefs
      );
      this.entries.delete(entry.key);
      this.inflight.delete(entry.key);
      this.host.emitEvent({
        key: entry.key,
        state: current.state,
        timestamp: Date.now(),
        type: "query_gc",
      });
    }, gcTime);
  }
}
