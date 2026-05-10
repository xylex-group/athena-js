export type QueryStatus = 'idle' | 'loading' | 'success' | 'error'

export type AthenaCacheMode = 'none' | 'memory'

export type QueryKey = readonly unknown[] | string

export interface AthenaQueryError {
  message: string
  status?: number
  code?: string
  details?: unknown
  raw?: unknown
}

export type AthenaRetryDelay = number | ((attempt: number) => number)

export type AthenaRetryCount = number | false

export interface AthenaResponseLike<T> {
  data?: T | null
  error?: unknown
  status?: number
  raw?: unknown
}

export interface AthenaQueryRequestLog {
  requestId: number
  queryKey: QueryKey
  queryKeyToken: string
  attempt: number
  startedAt: number
  endedAt?: number
}

export interface AthenaMutationRequestLog<TVariables = unknown> {
  requestId: number
  mutationKey?: QueryKey
  mutationKeyToken?: string
  attempt: number
  startedAt: number
  endedAt?: number
  variables?: TVariables
}

export interface AthenaQueryResult<TData = unknown> {
  data: TData | undefined
  error: AthenaQueryError | null
  status: number
  raw: unknown
}

export interface AthenaMutationResultData<TData = unknown> {
  data: TData | undefined
  error: AthenaQueryError | null
  status: number
  raw: unknown
}

export interface AthenaQueryState<TData = unknown> {
  status: QueryStatus
  isFetching: boolean
  data: TData | undefined
  error: AthenaQueryError | null
  lastRequest?: AthenaQueryRequestLog
  lastResponse?: unknown
  updatedAt?: number
}

export interface AthenaMutationState<TVariables = unknown, TData = unknown> {
  status: QueryStatus
  data: TData | undefined
  error: AthenaQueryError | null
  isLoading: boolean
  lastVariables?: TVariables
  lastRequest?: AthenaMutationRequestLog<TVariables>
  lastResponse?: unknown
  updatedAt?: number
}

export interface UseQueryOptions<TQueryFnData, TData = TQueryFnData> {
  queryKey: QueryKey
  queryFn: () => Promise<TQueryFnData>
  enabled?: boolean
  initialData?: TData
  refetchOnMount?: boolean
  refetchOnWindowFocus?: boolean
  refetchOnReconnect?: boolean
  retry?: AthenaRetryCount
  retryDelay?: AthenaRetryDelay
  select?: (data: TQueryFnData) => TData
  onSuccess?: (data: TData) => void
  onError?: (error: AthenaQueryError) => void
  onSettled?: (data: TData | undefined, error: AthenaQueryError | null) => void
}

export interface UseQueryResult<TData> {
  data: TData | undefined
  error: AthenaQueryError | null
  isLoading: boolean
  isFetching: boolean
  isSuccess: boolean
  isError: boolean
  status: QueryStatus
  refetch: () => Promise<AthenaQueryResult<TData>>
  reset: () => void
  lastResponse?: unknown
  lastRequest?: AthenaQueryRequestLog
}

export interface UseMutationOptions<TVariables, TMutationFnData, TData = TMutationFnData> {
  mutationFn: (variables: TVariables) => Promise<TMutationFnData>
  mutationKey?: QueryKey
  onMutate?: (variables: TVariables) => void | Promise<void>
  onSuccess?: (data: TData, variables: TVariables) => void
  onError?: (error: AthenaQueryError, variables: TVariables) => void
  onSettled?: (data: TData | undefined, error: AthenaQueryError | null, variables: TVariables) => void
  select?: (data: TMutationFnData) => TData
  retry?: AthenaRetryCount
  retryDelay?: AthenaRetryDelay
}

export interface UseMutationResult<TVariables, TData> {
  mutate: (variables: TVariables) => void
  mutateAsync: (variables: TVariables) => Promise<TData>
  data: TData | undefined
  error: AthenaQueryError | null
  isIdle: boolean
  isLoading: boolean
  isSuccess: boolean
  isError: boolean
  status: QueryStatus
  reset: () => void
  lastResponse?: unknown
  lastVariables?: TVariables
  lastRequest?: AthenaMutationRequestLog<TVariables>
}

export interface AthenaCachePolicy {
  mode?: AthenaCacheMode
  staleTime?: number
  gcTime?: number
}

export interface AthenaQueryDefaults {
  retry?: AthenaRetryCount
  retryDelay?: AthenaRetryDelay
  refetchOnMount?: boolean
  refetchOnWindowFocus?: boolean
  refetchOnReconnect?: boolean
}

export interface AthenaMutationDefaults {
  retry?: AthenaRetryCount
  retryDelay?: AthenaRetryDelay
}

export interface AthenaQueryClientConfig {
  cache?: AthenaCachePolicy
  defaultQueryOptions?: AthenaQueryDefaults
  defaultMutationOptions?: AthenaMutationDefaults
}

export type AthenaRuntimeEventType =
  | 'query_updated'
  | 'query_reset'
  | 'query_gc'
  | 'mutation_updated'
  | 'mutation_reset'

export interface AthenaRuntimeBaseEvent {
  type: AthenaRuntimeEventType
  timestamp: number
}

export interface AthenaQueryEvent extends AthenaRuntimeBaseEvent {
  type: 'query_updated' | 'query_reset' | 'query_gc'
  key: string
  state: AthenaQueryState<unknown>
}

export interface AthenaMutationEvent extends AthenaRuntimeBaseEvent {
  type: 'mutation_updated' | 'mutation_reset'
  key: string
  state: AthenaMutationState<unknown, unknown>
}

export type AthenaRuntimeEvent = AthenaQueryEvent | AthenaMutationEvent

export interface AthenaStateAdapter {
  onQueryUpdated?: (event: AthenaQueryEvent) => void
  onMutationUpdated?: (event: AthenaMutationEvent) => void
  onEvent?: (event: AthenaRuntimeEvent) => void
}

export type AthenaUnsubscribe = () => void
