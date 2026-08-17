export type QueryStatus = "idle" | "loading" | "success" | "error";

export type AthenaCacheMode = "none" | "memory";

export type QueryKey = readonly unknown[] | string;

export interface AthenaInvalidateQueriesFilters {
  /** Default false. When true, the stored key must equal the filter key. */
  exact?: boolean;
  /**
   * When omitted, every entry that stored a structured key is matched.
   * Array filters use tuple-prefix match unless `exact` is true.
   * String filters match stored string keys by equality only.
   */
  queryKey?: QueryKey;
  /**
   * Default true. Refetch only runs for matched entries that still have
   * listeners and a stored `queryFn`. Unmounted entries are marked stale.
   */
  refetch?: boolean;
}

export interface AthenaQueryError {
  code?: string;
  details?: unknown;
  message: string;
  raw?: unknown;
  status?: number;
}

export type AthenaRetryDelay = number | ((attempt: number) => number);

export type AthenaRetryCount = number | false;

export interface AthenaResponseLike<T> {
  data?: T | null;
  error?: unknown;
  raw?: unknown;
  status?: number;
}

export interface AthenaQueryRequestLog {
  attempt: number;
  endedAt?: number;
  queryKey: QueryKey;
  queryKeyToken: string;
  requestId: number;
  startedAt: number;
}

export interface AthenaMutationRequestLog<TVariables = unknown> {
  attempt: number;
  endedAt?: number;
  mutationKey?: QueryKey;
  mutationKeyToken?: string;
  requestId: number;
  startedAt: number;
  variables?: TVariables;
}

export interface AthenaQueryResult<TData = unknown> {
  data: TData | undefined;
  error: AthenaQueryError | null;
  raw: unknown;
  status: number;
}

export interface AthenaMutationResultData<TData = unknown> {
  data: TData | undefined;
  error: AthenaQueryError | null;
  raw: unknown;
  status: number;
}

export interface AthenaQueryState<TData = unknown> {
  data: TData | undefined;
  error: AthenaQueryError | null;
  isFetching: boolean;
  lastRequest?: AthenaQueryRequestLog;
  lastResponse?: unknown;
  status: QueryStatus;
  updatedAt?: number;
}

export interface AthenaMutationState<TVariables = unknown, TData = unknown> {
  data: TData | undefined;
  error: AthenaQueryError | null;
  isLoading: boolean;
  lastRequest?: AthenaMutationRequestLog<TVariables>;
  lastResponse?: unknown;
  lastVariables?: TVariables;
  status: QueryStatus;
  updatedAt?: number;
}

export interface UseQueryOptions<TQueryFnData, TData = TQueryFnData> {
  cacheMode?: AthenaCacheMode;
  descriptor?: import("../query/descriptor.ts").AthenaQueryDescriptor;
  enabled?: boolean;
  initialData?: TData;
  model?: import("../schema/types.ts").AthenaModelTarget;
  onError?: (error: AthenaQueryError) => void;
  onSettled?: (data: TData | undefined, error: AthenaQueryError | null) => void;
  onSuccess?: (data: TData) => void;
  queryFn: () => Promise<TQueryFnData>;
  queryKey: QueryKey;
  refetchOnMount?: boolean;
  refetchOnReconnect?: boolean;
  refetchOnWindowFocus?: boolean;
  retry?: AthenaRetryCount;
  retryDelay?: AthenaRetryDelay;
  select?: (data: TQueryFnData) => TData;
}

export interface UseQueryResult<TData> {
  data: TData | undefined;
  error: AthenaQueryError | null;
  isError: boolean;
  isFetching: boolean;
  isLoading: boolean;
  isSuccess: boolean;
  lastRequest?: AthenaQueryRequestLog;
  lastResponse?: unknown;
  refetch: () => Promise<AthenaQueryResult<TData>>;
  reset: () => void;
  status: QueryStatus;
}

export interface UseMutationOptions<
  TVariables,
  TMutationFnData,
  TData = TMutationFnData,
> {
  mutationFn: (variables: TVariables) => Promise<TMutationFnData>;
  mutationKey?: QueryKey;
  onError?: (error: AthenaQueryError, variables: TVariables) => void;
  onMutate?: (
    variables: TVariables
  ) =>
    | void
    | (() => void | Promise<void>)
    | Promise<void | (() => void | Promise<void>)>;
  onSettled?: (
    data: TData | undefined,
    error: AthenaQueryError | null,
    variables: TVariables
  ) => void;
  onSuccess?: (data: TData, variables: TVariables) => void;
  retry?: AthenaRetryCount;
  retryDelay?: AthenaRetryDelay;
  select?: (data: TMutationFnData) => TData;
}

export interface UseMutationResult<TVariables, TData> {
  data: TData | undefined;
  error: AthenaQueryError | null;
  isError: boolean;
  isIdle: boolean;
  isLoading: boolean;
  isSuccess: boolean;
  lastRequest?: AthenaMutationRequestLog<TVariables>;
  lastResponse?: unknown;
  lastVariables?: TVariables;
  mutate: (variables: TVariables) => void;
  mutateAsync: (variables: TVariables) => Promise<TData>;
  reset: () => void;
  status: QueryStatus;
}

export interface AthenaCachePolicy {
  gcTime?: number;
  mode?: AthenaCacheMode;
  staleTime?: number;
}

export interface AthenaQueryDefaults {
  refetchOnMount?: boolean;
  refetchOnReconnect?: boolean;
  refetchOnWindowFocus?: boolean;
  retry?: AthenaRetryCount;
  retryDelay?: AthenaRetryDelay;
}

export interface AthenaMutationDefaults {
  retry?: AthenaRetryCount;
  retryDelay?: AthenaRetryDelay;
}

export interface AthenaQueryClientConfig {
  cache?: AthenaCachePolicy;
  defaultMutationOptions?: AthenaMutationDefaults;
  defaultQueryOptions?: AthenaQueryDefaults;
}

export type AthenaRuntimeEventType =
  | "query_updated"
  | "query_reset"
  | "query_gc"
  | "mutation_updated"
  | "mutation_reset";

export interface AthenaRuntimeBaseEvent {
  timestamp: number;
  type: AthenaRuntimeEventType;
}

export interface AthenaQueryEvent extends AthenaRuntimeBaseEvent {
  key: string;
  state: AthenaQueryState<unknown>;
  type: "query_updated" | "query_reset" | "query_gc";
}

export interface AthenaMutationEvent extends AthenaRuntimeBaseEvent {
  key: string;
  state: AthenaMutationState<unknown, unknown>;
  type: "mutation_updated" | "mutation_reset";
}

export type AthenaRuntimeEvent = AthenaQueryEvent | AthenaMutationEvent;

export interface AthenaStateAdapter {
  onEvent?: (event: AthenaRuntimeEvent) => void;
  onMutationUpdated?: (event: AthenaMutationEvent) => void;
  onQueryUpdated?: (event: AthenaQueryEvent) => void;
}

export type AthenaUnsubscribe = () => void;
