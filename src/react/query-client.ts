import type {
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
} from './types.ts'
import { normalizeAthenaError, normalizeAthenaResult, runWithRetry, safeSerializeQueryKey } from './utils.ts'

type ExecuteQueryInput<TQueryFnData, TData> = {
  queryKey: QueryKey
  queryKeyToken: string
  queryFn: () => Promise<TQueryFnData>
  select?: (data: TQueryFnData) => TData
  retry?: number | false
  retryDelay?: number | ((attempt: number) => number)
  dedupe?: boolean
  force?: boolean
}

type ExecuteMutationInput<TVariables, TMutationFnData, TData> = {
  mutationKey?: QueryKey
  mutationKeyToken: string
  variables: TVariables
  mutationFn: (variables: TVariables) => Promise<TMutationFnData>
  select?: (data: TMutationFnData) => TData
  retry?: number | false
  retryDelay?: number | ((attempt: number) => number)
}

type QueryEntry = {
  key: string
  state: AthenaQueryState<unknown>
  listeners: Set<() => void>
  gcTimer?: ReturnType<typeof setTimeout>
  activeRequestId: number
}

type MutationEntry = {
  key: string
  state: AthenaMutationState<unknown, unknown>
  listeners: Set<() => void>
  gcTimer?: ReturnType<typeof setTimeout>
  activeRequestId: number
}

function createInitialQueryState<TData>(initialData?: TData): AthenaQueryState<TData> {
  return {
    status: initialData === undefined ? 'idle' : 'success',
    isFetching: false,
    data: initialData,
    error: null,
    updatedAt: initialData === undefined ? undefined : Date.now(),
  }
}

function createInitialMutationState<TVariables, TData>(): AthenaMutationState<TVariables, TData> {
  return {
    status: 'idle',
    data: undefined,
    error: null,
    isLoading: false,
    lastVariables: undefined,
    lastResponse: undefined,
    updatedAt: undefined,
  }
}

function shouldUseMemoryCache(config: AthenaQueryClientConfig): boolean {
  return config.cache?.mode === 'memory'
}

export class AthenaQueryClient {
  private readonly queryEntries = new Map<string, QueryEntry>()
  private readonly mutationEntries = new Map<string, MutationEntry>()
  private readonly inflightQueries = new Map<string, Promise<AthenaQueryResult<unknown>>>()
  private readonly eventSubscribers = new Set<(event: AthenaRuntimeEvent) => void>()
  private readonly adapters = new Set<AthenaStateAdapter>()
  private requestCounter = 0

  readonly config: AthenaQueryClientConfig
  readonly defaultQueryOptions: AthenaQueryDefaults
  readonly defaultMutationOptions: AthenaMutationDefaults

  constructor(config: AthenaQueryClientConfig = {}) {
    this.config = {
      cache: {
        mode: config.cache?.mode ?? 'none',
        staleTime: config.cache?.staleTime,
        gcTime: config.cache?.gcTime,
      },
      defaultQueryOptions: config.defaultQueryOptions,
      defaultMutationOptions: config.defaultMutationOptions,
    }
    this.defaultQueryOptions = {
      retry: config.defaultQueryOptions?.retry ?? 0,
      retryDelay: config.defaultQueryOptions?.retryDelay,
      refetchOnMount: config.defaultQueryOptions?.refetchOnMount ?? true,
      refetchOnWindowFocus: config.defaultQueryOptions?.refetchOnWindowFocus ?? false,
      refetchOnReconnect: config.defaultQueryOptions?.refetchOnReconnect ?? false,
    }
    this.defaultMutationOptions = {
      retry: config.defaultMutationOptions?.retry ?? 0,
      retryDelay: config.defaultMutationOptions?.retryDelay,
    }
  }

  getQueryKeyToken(queryKey: QueryKey): string {
    return safeSerializeQueryKey(queryKey)
  }

  getMutationKeyToken(mutationKey?: QueryKey): string {
    if (mutationKey == null) {
      return '__mutation__default__'
    }
    return safeSerializeQueryKey(mutationKey)
  }

  getQueryState<TData = unknown>(key: string): AthenaQueryState<TData> {
    const entry = this.ensureQueryEntry(key)
    return entry.state as AthenaQueryState<TData>
  }

  getMutationState<TVariables = unknown, TData = unknown>(
    key: string,
  ): AthenaMutationState<TVariables, TData> {
    const entry = this.ensureMutationEntry(key)
    return entry.state as AthenaMutationState<TVariables, TData>
  }

  subscribeQuery(key: string, listener: () => void): AthenaUnsubscribe {
    const entry = this.ensureQueryEntry(key)
    if (entry.gcTimer) {
      clearTimeout(entry.gcTimer)
      entry.gcTimer = undefined
    }
    entry.listeners.add(listener)
    return () => {
      const current = this.queryEntries.get(key)
      if (!current) return
      current.listeners.delete(listener)
      if (current.listeners.size === 0) {
        this.scheduleQueryGc(current)
      }
    }
  }

  subscribeMutation(key: string, listener: () => void): AthenaUnsubscribe {
    const entry = this.ensureMutationEntry(key)
    if (entry.gcTimer) {
      clearTimeout(entry.gcTimer)
      entry.gcTimer = undefined
    }
    entry.listeners.add(listener)
    return () => {
      const current = this.mutationEntries.get(key)
      if (!current) return
      current.listeners.delete(listener)
      if (current.listeners.size === 0) {
        this.scheduleMutationGc(current)
      }
    }
  }

  subscribeEvents(listener: (event: AthenaRuntimeEvent) => void): AthenaUnsubscribe {
    this.eventSubscribers.add(listener)
    return () => {
      this.eventSubscribers.delete(listener)
    }
  }

  attachAdapter(adapter: AthenaStateAdapter): AthenaUnsubscribe {
    this.adapters.add(adapter)
    return () => {
      this.adapters.delete(adapter)
    }
  }

  resetQuery(queryKey: QueryKey): void {
    const key = this.getQueryKeyToken(queryKey)
    const entry = this.ensureQueryEntry(key)
    this.setQueryState(entry, createInitialQueryState(), 'query_reset')
    this.inflightQueries.delete(key)
  }

  resetMutation(mutationKey?: QueryKey): void {
    const key = this.getMutationKeyToken(mutationKey)
    const entry = this.ensureMutationEntry(key)
    this.setMutationState(entry, createInitialMutationState(), 'mutation_reset')
  }

  async executeQuery<TQueryFnData, TData = TQueryFnData>(
    input: ExecuteQueryInput<TQueryFnData, TData>,
  ): Promise<AthenaQueryResult<TData>> {
    const entry = this.ensureQueryEntry(input.queryKeyToken)

    if (input.dedupe !== false) {
      const existing = this.inflightQueries.get(input.queryKeyToken)
      if (existing) {
        return existing as Promise<AthenaQueryResult<TData>>
      }
    }

    if (!input.force && shouldUseMemoryCache(this.config)) {
      const staleTime = this.config.cache?.staleTime ?? 0
      const hasFreshData =
        entry.state.status === 'success' &&
        entry.state.data !== undefined &&
        entry.state.updatedAt !== undefined &&
        Date.now() - entry.state.updatedAt <= staleTime
      if (hasFreshData) {
        return {
          data: entry.state.data as TData,
          error: null,
          status: 200,
          raw: entry.state.lastResponse ?? entry.state.data,
        }
      }
    }

    const requestId = ++this.requestCounter
    entry.activeRequestId = requestId

    const startRequestLog: AthenaQueryRequestLog = {
      requestId,
      queryKey: input.queryKey,
      queryKeyToken: input.queryKeyToken,
      attempt: 1,
      startedAt: Date.now(),
    }

    const loadingStatus = entry.state.data === undefined ? 'loading' : entry.state.status
    this.setQueryState(
      entry,
      {
        ...entry.state,
        status: loadingStatus,
        isFetching: true,
        error: null,
        lastRequest: startRequestLog,
      },
      'query_updated',
    )

    const executionPromise = runWithRetry(
      async attempt => {
        const attemptRequestLog: AthenaQueryRequestLog = {
          ...startRequestLog,
          attempt,
        }

        if (entry.activeRequestId === requestId) {
          this.setQueryState(
            entry,
            {
              ...entry.state,
              lastRequest: attemptRequestLog,
              isFetching: true,
            },
            'query_updated',
          )
        }

        const rawResult = await input.queryFn()
        const normalized = normalizeAthenaResult<TQueryFnData, TData>(rawResult, input.select)

        if (normalized.error) {
          throw {
            __athenaNormalizedError: normalized.error,
            __athenaStatus: normalized.status,
            __athenaRaw: normalized.raw,
            __athenaResponse: rawResult,
          }
        }

        return {
          normalized,
          response: rawResult,
          attempt,
        }
      },
      {
        retry: input.retry,
        retryDelay: input.retryDelay,
      },
    )
      .then(result => {
        if (entry.activeRequestId === requestId) {
          const finishedAt = Date.now()
          const doneRequestLog: AthenaQueryRequestLog = {
            ...startRequestLog,
            attempt: result.attempt,
            endedAt: finishedAt,
          }
          this.setQueryState(
            entry,
            {
              ...entry.state,
              status: 'success',
              isFetching: false,
              error: null,
              data: result.normalized.data,
              lastRequest: doneRequestLog,
              lastResponse: result.response,
              updatedAt: finishedAt,
            },
            'query_updated',
          )
        }

        return result.normalized
      })
      .catch(error => {
        const wrapped =
          typeof error === 'object' && error !== null ? (error as Record<string, unknown>) : undefined

        const normalizedError = wrapped?.__athenaNormalizedError
          ? (wrapped.__athenaNormalizedError as ReturnType<typeof normalizeAthenaError>)
          : normalizeAthenaError(error)

        const status =
          typeof wrapped?.__athenaStatus === 'number'
            ? (wrapped.__athenaStatus as number)
            : normalizedError.status ?? 500

        const raw = wrapped?.__athenaRaw ?? normalizedError.raw ?? null
        const response = wrapped?.__athenaResponse ?? raw

        if (entry.activeRequestId === requestId) {
          const finishedAt = Date.now()
          const doneRequestLog: AthenaQueryRequestLog = {
            ...startRequestLog,
            endedAt: finishedAt,
            attempt:
              entry.state.lastRequest?.requestId === requestId
                ? entry.state.lastRequest.attempt
                : startRequestLog.attempt,
          }
          this.setQueryState(
            entry,
            {
              ...entry.state,
              status: 'error',
              isFetching: false,
              error: normalizedError,
              lastRequest: doneRequestLog,
              lastResponse: response,
              updatedAt: finishedAt,
            },
            'query_updated',
          )
        }

        return {
          data: undefined,
          error: normalizedError,
          status,
          raw,
        } as AthenaQueryResult<TData>
      })
      .finally(() => {
        const inflight = this.inflightQueries.get(input.queryKeyToken)
        if (inflight === executionPromise) {
          this.inflightQueries.delete(input.queryKeyToken)
        }
      })

    this.inflightQueries.set(input.queryKeyToken, executionPromise as Promise<AthenaQueryResult<unknown>>)

    return executionPromise
  }

  async executeMutation<TVariables, TMutationFnData, TData = TMutationFnData>(
    input: ExecuteMutationInput<TVariables, TMutationFnData, TData>,
  ): Promise<AthenaMutationResultData<TData>> {
    const entry = this.ensureMutationEntry(input.mutationKeyToken)
    const requestId = ++this.requestCounter
    entry.activeRequestId = requestId

    const startRequestLog: AthenaMutationRequestLog<TVariables> = {
      requestId,
      mutationKey: input.mutationKey,
      mutationKeyToken: input.mutationKeyToken,
      attempt: 1,
      startedAt: Date.now(),
      variables: input.variables,
    }

    this.setMutationState(
      entry,
      {
        ...entry.state,
        status: 'loading',
        isLoading: true,
        error: null,
        lastVariables: input.variables,
        lastRequest: startRequestLog,
      },
      'mutation_updated',
    )

    try {
      const result = await runWithRetry(
        async attempt => {
          const attemptRequestLog: AthenaMutationRequestLog<TVariables> = {
            ...startRequestLog,
            attempt,
          }

          if (entry.activeRequestId === requestId) {
            this.setMutationState(
              entry,
              {
                ...entry.state,
                lastRequest: attemptRequestLog,
                isLoading: true,
              },
              'mutation_updated',
            )
          }

          const rawResult = await input.mutationFn(input.variables)
          const normalized = normalizeAthenaResult<TMutationFnData, TData>(rawResult, input.select)
          if (normalized.error) {
            throw {
              __athenaNormalizedError: normalized.error,
              __athenaStatus: normalized.status,
              __athenaRaw: normalized.raw,
              __athenaResponse: rawResult,
            }
          }

          return {
            normalized,
            response: rawResult,
            attempt,
          }
        },
        {
          retry: input.retry,
          retryDelay: input.retryDelay,
        },
      )

      if (entry.activeRequestId === requestId) {
        const finishedAt = Date.now()
        const doneRequestLog: AthenaMutationRequestLog<TVariables> = {
          ...startRequestLog,
          attempt: result.attempt,
          endedAt: finishedAt,
        }
        this.setMutationState(
          entry,
          {
            ...entry.state,
            status: 'success',
            isLoading: false,
            data: result.normalized.data,
            error: null,
            lastVariables: input.variables,
            lastRequest: doneRequestLog,
            lastResponse: result.response,
            updatedAt: finishedAt,
          },
          'mutation_updated',
        )
      }

      return result.normalized
    } catch (error) {
      const wrapped =
        typeof error === 'object' && error !== null ? (error as Record<string, unknown>) : undefined
      const normalizedError = wrapped?.__athenaNormalizedError
        ? (wrapped.__athenaNormalizedError as ReturnType<typeof normalizeAthenaError>)
        : normalizeAthenaError(error)

      const status =
        typeof wrapped?.__athenaStatus === 'number'
          ? (wrapped.__athenaStatus as number)
          : normalizedError.status ?? 500
      const raw = wrapped?.__athenaRaw ?? normalizedError.raw ?? null
      const response = wrapped?.__athenaResponse ?? raw

      if (entry.activeRequestId === requestId) {
        const finishedAt = Date.now()
        const doneRequestLog: AthenaMutationRequestLog<TVariables> = {
          ...startRequestLog,
          endedAt: finishedAt,
          attempt:
            entry.state.lastRequest?.requestId === requestId
              ? entry.state.lastRequest.attempt
              : startRequestLog.attempt,
        }

        this.setMutationState(
          entry,
          {
            ...entry.state,
            status: 'error',
            isLoading: false,
            error: normalizedError,
            lastVariables: input.variables,
            lastRequest: doneRequestLog,
            lastResponse: response,
            updatedAt: finishedAt,
          },
          'mutation_updated',
        )
      }

      return {
        data: undefined,
        error: normalizedError,
        status,
        raw,
      }
    }
  }

  private ensureQueryEntry(key: string): QueryEntry {
    let entry = this.queryEntries.get(key)
    if (entry) return entry

    entry = {
      key,
      state: createInitialQueryState(),
      listeners: new Set(),
      activeRequestId: 0,
    }
    this.queryEntries.set(key, entry)
    return entry
  }

  private ensureMutationEntry(key: string): MutationEntry {
    let entry = this.mutationEntries.get(key)
    if (entry) return entry

    entry = {
      key,
      state: createInitialMutationState(),
      listeners: new Set(),
      activeRequestId: 0,
    }
    this.mutationEntries.set(key, entry)
    return entry
  }

  private scheduleQueryGc(entry: QueryEntry): void {
    const gcTime = shouldUseMemoryCache(this.config)
      ? Math.max(0, this.config.cache?.gcTime ?? 300_000)
      : Math.max(0, this.config.cache?.gcTime ?? 0)

    entry.gcTimer = setTimeout(() => {
      const current = this.queryEntries.get(entry.key)
      if (!current || current.listeners.size > 0) return
      this.queryEntries.delete(entry.key)
      this.inflightQueries.delete(entry.key)
      this.emitEvent({
        type: 'query_gc',
        key: entry.key,
        state: current.state,
        timestamp: Date.now(),
      })
    }, gcTime)
  }

  private scheduleMutationGc(entry: MutationEntry): void {
    const gcTime = shouldUseMemoryCache(this.config)
      ? Math.max(0, this.config.cache?.gcTime ?? 300_000)
      : Math.max(0, this.config.cache?.gcTime ?? 0)

    entry.gcTimer = setTimeout(() => {
      const current = this.mutationEntries.get(entry.key)
      if (!current || current.listeners.size > 0) return
      this.mutationEntries.delete(entry.key)
    }, gcTime)
  }

  private setQueryState(
    entry: QueryEntry,
    state: AthenaQueryState<unknown>,
    eventType: AthenaQueryEvent['type'],
  ): void {
    entry.state = state
    for (const listener of entry.listeners) {
      listener()
    }

    this.emitEvent({
      type: eventType,
      key: entry.key,
      state,
      timestamp: Date.now(),
    })
  }

  private setMutationState(
    entry: MutationEntry,
    state: AthenaMutationState<unknown, unknown>,
    eventType: AthenaMutationEvent['type'],
  ): void {
    entry.state = state
    for (const listener of entry.listeners) {
      listener()
    }

    this.emitEvent({
      type: eventType,
      key: entry.key,
      state,
      timestamp: Date.now(),
    })
  }

  private emitEvent(event: AthenaRuntimeEvent): void {
    for (const listener of this.eventSubscribers) {
      listener(event)
    }

    for (const adapter of this.adapters) {
      adapter.onEvent?.(event)
      if (event.type === 'query_updated' || event.type === 'query_reset' || event.type === 'query_gc') {
        adapter.onQueryUpdated?.(event)
      }
      if (event.type === 'mutation_updated' || event.type === 'mutation_reset') {
        adapter.onMutationUpdated?.(event)
      }
    }
  }
}

export function createAthenaQueryClient(config?: AthenaQueryClientConfig): AthenaQueryClient {
  return new AthenaQueryClient(config)
}

export function attachStateAdapter(
  client: AthenaQueryClient,
  adapter: AthenaStateAdapter,
): AthenaUnsubscribe {
  return client.attachAdapter(adapter)
}
