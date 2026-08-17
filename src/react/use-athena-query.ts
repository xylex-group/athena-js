import { useRef } from "react";
import type { AthenaExecutable } from "../query/descriptor.ts";
import type { UseQueryOptions, UseQueryResult } from "./types.ts";
import { useQuery } from "./use-query.ts";

export type UseAthenaQueryOptions<TResult> = Omit<
  UseQueryOptions<TResult>,
  "queryFn" | "queryKey"
> & {
  /** Override the descriptor-derived key. Applications should rarely set this. */
  queryKey?: UseQueryOptions<TResult>["queryKey"];
};

/**
 * Subscribe to an Athena executable query (`athena.from(Model).select()...`).
 *
 * Identity is the frozen descriptor captured from this query object on first
 * subscribe. Rebuild the chain when inputs change — mutating the same builder
 * after subscribe does not retarget the observer.
 *
 * Uses memory-cache freshness for this query only. The client-global default
 * `cache.mode` stays `"none"`.
 */
export function useAthenaQuery<TResult>(
  query: AthenaExecutable<TResult>,
  options: UseAthenaQueryOptions<TResult> = {}
): UseQueryResult<TResult> {
  const sourceRef = useRef(query);
  const capturedRef = useRef<AthenaExecutable<TResult> | null>(null);

  if (sourceRef.current !== query) {
    sourceRef.current = query;
    capturedRef.current = null;
  }
  if (!capturedRef.current) {
    capturedRef.current = query.capture();
  }

  const captured = capturedRef.current;
  const descriptor = captured.getDescriptor();
  const queryKey = options.queryKey ?? descriptor.queryKey;

  return useQuery<TResult>({
    ...options,
    cacheMode: options.cacheMode ?? "memory",
    descriptor,
    model: captured.model,
    queryFn: () => captured.execute(),
    queryKey,
  });
}
