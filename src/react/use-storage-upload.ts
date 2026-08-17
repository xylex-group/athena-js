import * as React from "react";
import type {
  AthenaStorageFileUploadInput,
  AthenaStorageFileUploadResult,
  AthenaStorageUploadProgress,
  AthenaStorageUploadProgressHandler,
  AthenaStorageUploadSource,
} from "../storage/file.ts";
import type {
  AthenaStorageCallOptions,
  AthenaStorageModule,
} from "../storage/module.ts";

export type UseStorageUploadInput =
  | AthenaStorageFileUploadInput
  | AthenaStorageUploadSource
  | readonly AthenaStorageUploadSource[]
  | ArrayLike<AthenaStorageUploadSource>;

export interface UseStorageUploadOptions
  extends Omit<Partial<AthenaStorageFileUploadInput>, "files" | "onProgress"> {
  onProgress?: AthenaStorageUploadProgressHandler;
  storage: Pick<AthenaStorageModule, "file">;
}

export interface UseStorageUploadResult {
  abort: () => void;
  error: unknown;
  percent: number;
  progress: AthenaStorageUploadProgress | null;
  reset: () => void;
  result: AthenaStorageFileUploadResult | null;
  upload: (
    input: UseStorageUploadInput,
    options?: AthenaStorageCallOptions
  ) => Promise<AthenaStorageFileUploadResult>;
  uploading: boolean;
}

export function useStorageUpload(
  options: UseStorageUploadOptions
): UseStorageUploadResult {
  const { storage, onProgress, ...defaults } = options;
  const [uploading, setUploading] = React.useState(false);
  const [progress, setProgress] =
    React.useState<AthenaStorageUploadProgress | null>(null);
  const [error, setError] = React.useState<unknown>(null);
  const [result, setResult] =
    React.useState<AthenaStorageFileUploadResult | null>(null);
  const controllerRef = React.useRef<AbortController | null>(null);

  const reset = React.useCallback(() => {
    setUploading(false);
    setProgress(null);
    setError(null);
    setResult(null);
  }, []);

  const abort = React.useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
  }, []);

  const upload = React.useCallback(
    async (
      input: UseStorageUploadInput,
      callOptions?: AthenaStorageCallOptions
    ) => {
      const controller = callOptions?.signal ? null : new AbortController();
      controllerRef.current = controller;
      setUploading(true);
      setError(null);
      setResult(null);

      const request = normalizeHookUploadInput(
        defaults,
        input,
        (progressEvent) => {
          setProgress(progressEvent);
          onProgress?.(progressEvent);
          if (isStorageUploadInput(input)) {
            input.onProgress?.(progressEvent);
          }
        }
      );

      try {
        const uploaded = await storage.file.upload(request, {
          ...callOptions,
          signal: callOptions?.signal ?? controller?.signal,
        });
        setResult(uploaded);
        return uploaded;
      } catch (uploadError) {
        setError(uploadError);
        throw uploadError;
      } finally {
        setUploading(false);
        if (controllerRef.current === controller) {
          controllerRef.current = null;
        }
      }
    },
    [defaults, onProgress, storage]
  );

  return {
    abort,
    error,
    percent: progress?.aggregatePercent ?? 0,
    progress,
    reset,
    result,
    upload,
    uploading,
  };
}

function normalizeHookUploadInput(
  defaults: Omit<Partial<AthenaStorageFileUploadInput>, "files" | "onProgress">,
  input: UseStorageUploadInput,
  onProgress: AthenaStorageUploadProgressHandler
): AthenaStorageFileUploadInput {
  if (isStorageUploadInput(input)) {
    return {
      ...defaults,
      ...input,
      onProgress,
    } as AthenaStorageFileUploadInput;
  }
  return {
    ...defaults,
    files: input,
    onProgress,
  } as AthenaStorageFileUploadInput;
}

function isStorageUploadInput(
  input: UseStorageUploadInput
): input is AthenaStorageFileUploadInput {
  return (
    Boolean(input) &&
    typeof input === "object" &&
    "files" in input &&
    "s3_id" in input
  );
}
