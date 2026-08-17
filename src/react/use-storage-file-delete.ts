import * as React from "react";
import type {
  AthenaStorageCallOptions,
  AthenaStorageModule,
  StorageFileMutationResponse,
} from "../storage/module.ts";

export interface UseStorageFileDeleteOptions {
  onError?: (error: unknown) => void;
  onSuccess?: (
    result: StorageFileMutationResponse | StorageFileMutationResponse[]
  ) => void;
  storage: Pick<AthenaStorageModule, "file">;
}

export interface UseStorageFileDeleteResult {
  deleteFile: (
    fileId: string | readonly string[],
    options?: AthenaStorageCallOptions
  ) => Promise<StorageFileMutationResponse | StorageFileMutationResponse[]>;
  deleting: boolean;
  error: unknown;
  reset: () => void;
}

export function useStorageFileDelete(
  options: UseStorageFileDeleteOptions
): UseStorageFileDeleteResult {
  const { storage, onSuccess, onError } = options;
  const [deleting, setDeleting] = React.useState(false);
  const [error, setError] = React.useState<unknown>(null);

  const reset = React.useCallback(() => {
    setDeleting(false);
    setError(null);
  }, []);

  const deleteFile = React.useCallback(
    async (
      fileId: string | readonly string[],
      callOptions?: AthenaStorageCallOptions
    ) => {
      setDeleting(true);
      setError(null);
      try {
        const result = await storage.file.delete(
          fileId as string & readonly string[],
          callOptions
        );
        onSuccess?.(result);
        return result;
      } catch (deleteError) {
        setError(deleteError);
        onError?.(deleteError);
        throw deleteError;
      } finally {
        setDeleting(false);
      }
    },
    [onError, onSuccess, storage]
  );

  return {
    deleteFile,
    deleting,
    error,
    reset,
  };
}
