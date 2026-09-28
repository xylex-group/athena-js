import type {
  AthenaQueryResult,
  AthenaQueryState,
  UseQueryResult,
} from "../types.ts";

export function projectQuerySnapshot<TData>(
  snapshot: AthenaQueryState<TData>,
  initialData: TData | undefined
): AthenaQueryState<TData> {
  if (
    snapshot.status === "idle" &&
    snapshot.data === undefined &&
    initialData !== undefined
  ) {
    return {
      ...snapshot,
      data: initialData,
      error: null,
      status: "success",
    };
  }
  return snapshot;
}

export function toUseQueryResult<TData>(
  snapshot: AthenaQueryState<TData>,
  actions: {
    refetch: () => Promise<AthenaQueryResult<TData>>;
    reset: () => void;
  }
): UseQueryResult<TData> {
  return {
    data: snapshot.data,
    error: snapshot.error,
    isError: snapshot.status === "error",
    isFetching: snapshot.isFetching,
    isLoading: snapshot.status === "loading" && snapshot.data === undefined,
    isSuccess: snapshot.status === "success",
    lastRequest: snapshot.lastRequest,
    lastResponse: snapshot.lastResponse,
    refetch: actions.refetch,
    reset: actions.reset,
    status: snapshot.status,
  };
}
