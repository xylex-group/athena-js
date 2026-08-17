import * as React from "react";
import type { AthenaStorageFileListInput } from "../storage/file.ts";
import type {
  AthenaStorageCallOptions,
  AthenaStorageModule,
  StorageListFilesResponse,
} from "../storage/module.ts";

export interface UseStorageFilesOptions {
  callOptions?: AthenaStorageCallOptions;
  enabled?: boolean;
  input: AthenaStorageFileListInput | null | undefined;
  refreshIntervalMs?: number;
  storage: Pick<AthenaStorageModule, "file">;
}

export interface UseStorageFilesResult {
  count: number;
  data: StorageListFilesResponse | null;
  error: unknown;
  files: StorageListFilesResponse["files"];
  loading: boolean;
  refetch: () => Promise<StorageListFilesResponse | null>;
}

export function useStorageFiles(
  options: UseStorageFilesOptions
): UseStorageFilesResult {
  const {
    storage,
    input,
    enabled = true,
    callOptions,
    refreshIntervalMs,
  } = options;
  const [data, setData] = React.useState<StorageListFilesResponse | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<unknown>(null);
  const requestIdRef = React.useRef(0);

  const refetch = React.useCallback(async () => {
    if (!(input && enabled)) {
      setData(null);
      setError(null);
      setLoading(false);
      return null;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);
    setError(null);

    try {
      const result = await storage.file.list(input, callOptions);
      if (requestIdRef.current === requestId) {
        setData(result);
      }
      return result;
    } catch (listError) {
      if (requestIdRef.current === requestId) {
        setError(listError);
        setData(null);
      }
      throw listError;
    } finally {
      if (requestIdRef.current === requestId) {
        setLoading(false);
      }
    }
  }, [callOptions, enabled, input, storage]);

  React.useEffect(() => {
    void refetch().catch(() => {
      // Error is already stored in state.
    });
  }, [refetch]);

  React.useEffect(() => {
    if (!(enabled && input && refreshIntervalMs) || refreshIntervalMs <= 0) {
      return;
    }
    const globalObject = globalThis as typeof globalThis & {
      setInterval: typeof setInterval;
      clearInterval: typeof clearInterval;
    };
    const timer = globalObject.setInterval(() => {
      void refetch().catch(() => {
        // Error is already stored in state.
      });
    }, refreshIntervalMs);
    return () => globalObject.clearInterval(timer);
  }, [enabled, input, refetch, refreshIntervalMs]);

  return {
    count: data?.count ?? data?.files?.length ?? 0,
    data,
    error,
    files: data?.files ?? [],
    loading,
    refetch,
  };
}
