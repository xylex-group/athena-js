import { putDirectStorageUploadBody } from "./direct-upload.ts";
import type {
  AthenaStorageBinaryCallOptions,
  AthenaStorageCallOptions,
  AthenaStorageDirectUploadConfig,
  CreateStorageUploadUrlRequest,
  GetStorageFileUrlQuery,
  ListStorageFilesRequest,
  ManagedFileRecord,
  StorageBatchUploadUrlResponse,
  StorageFileMutationResponse,
  StorageListFilesResponse,
  StorageMultipartAbortRequest,
  StorageMultipartCompleteRequest,
  StorageMultipartCreateRequest,
  StorageMultipartSignPartRequest,
  StorageServerSideEncryptionOptions,
  StorageUploadUrlResponse,
} from "./module.ts";
import {
  type AthenaStorageXhrPutBody,
  canUseStorageXhrPut,
  putStorageBodyWithXhr,
} from "./xhr-put.ts";

/** Files at or above this size use multipart unless `forceSinglePut` is set. */
export const DEFAULT_MULTIPART_THRESHOLD_BYTES = 32 * 1024 * 1024;
/** Chunk size for multipart uploads (S3 requires >= 5 MiB except the last part). */
export const DEFAULT_MULTIPART_PART_SIZE_BYTES = 8 * 1024 * 1024;
const MIN_MULTIPART_PART_SIZE_BYTES = 5 * 1024 * 1024;

export type AthenaStorageTemplateValue =
  | string
  | number
  | boolean
  | null
  | undefined;
export type AthenaStorageTemplateVars = Record<
  string,
  AthenaStorageTemplateValue
>;
export type AthenaStorageEnv = Record<string, string | undefined>;
export type AthenaStorageUploadHeaders = ConstructorParameters<
  typeof Headers
>[0];
export type AthenaStoragePrefixPath =
  | string
  | ((context: AthenaStoragePathContext) => string | null | undefined);

export interface AthenaStoragePathContext {
  env: AthenaStorageEnv;
  organization_id?: string;
  organizationId?: string;
  resource_id?: string;
  resourceId?: string;
  user_id?: string;
  userId?: string;
  vars: AthenaStorageTemplateVars;
}

export interface AthenaStorageFileConfig {
  directUpload?: AthenaStorageDirectUploadConfig;
  env?: AthenaStorageEnv;
  /**
   * Prefix applied by high-level file helpers before storage keys are sent to Athena.
   * Supports tokens such as `{organization_id}`, `{organizationId}`, `{env.NODE_ENV}`,
   * and `${ATHENA_STORAGE_PREFIX}`.
   */
  prefixPath?: AthenaStoragePrefixPath;
  vars?: AthenaStorageTemplateVars;
}

export type AthenaStorageUploadSource = Blob | ArrayBuffer | Uint8Array;

export interface AthenaStorageUploadConstraints {
  allowedExtensions?: readonly string[];
  extensions?: readonly string[];
  maxFileSizeBytes?: number;
  maxFileSizeMb?: number;
  maxFiles?: number;
}

export interface AthenaStorageUploadProgress {
  aggregateLoaded: number;
  aggregatePercent: number;
  aggregateTotal: number;
  fileCount: number;
  fileIndex: number;
  fileName: string;
  loaded: number;
  /** Present when the active file is uploading via multipart. */
  multipart?: {
    uploadId: string;
    partNumber: number;
    partCount: number;
  };
  percent: number;
  phase: "preparing" | "uploading" | "complete";
  total: number;
}

export type AthenaStorageUploadProgressHandler = (
  progress: AthenaStorageUploadProgress
) => void;

export interface AthenaStorageFileUploadInput
  extends AthenaStorageUploadConstraints,
    StorageServerSideEncryptionOptions {
  bucket?: string;
  content_type?: string;
  env?: AthenaStorageEnv;
  fileName?: string;
  files:
    | AthenaStorageUploadSource
    | ArrayLike<AthenaStorageUploadSource>
    | readonly AthenaStorageUploadSource[];
  /** Always use multipart even when the file is below the threshold. */
  forceMultipart?: boolean;
  /** Always use a single PUT even when the file exceeds the multipart threshold. */
  forceSinglePut?: boolean;
  metadata?: Record<string, unknown>;
  mime_type?: string;
  /** Override multipart chunk size (default 8 MiB, minimum 5 MiB). */
  multipartPartSizeBytes?: number;
  /** Override auto-multipart threshold (default 32 MiB). */
  multipartThresholdBytes?: number;
  name?: string;
  onProgress?: AthenaStorageUploadProgressHandler;
  organization_id?: string;
  organizationId?: string;
  original_name?: string;
  prefixPath?: AthenaStoragePrefixPath;
  public?: boolean;
  resource_id?: string;
  resourceId?: string;
  s3_id?: string;
  storage_key?: string;
  storageKey?: string;
  storageKeyTemplate?: string;
  uploadHeaders?: AthenaStorageUploadHeaders;
  user_id?: string;
  userId?: string;
  vars?: AthenaStorageTemplateVars;
}

export interface AthenaStorageUploadedFile {
  file: ManagedFileRecord;
  fileName: string;
  response: Response;
  source: AthenaStorageUploadSource;
  storage_key: string;
  upload: StorageUploadUrlResponse["upload"];
}

export interface AthenaStorageFileUploadResult {
  count: number;
  files: AthenaStorageUploadedFile[];
}

export interface AthenaStorageFileListInput
  extends Omit<ListStorageFilesRequest, "prefix"> {
  env?: AthenaStorageEnv;
  organization_id?: string;
  organizationId?: string;
  prefix?: string;
  prefixPath?: AthenaStoragePrefixPath;
  resource_id?: string;
  resourceId?: string;
  user_id?: string;
  userId?: string;
  vars?: AthenaStorageTemplateVars;
}

export interface AthenaStorageFileDownloadInput extends GetStorageFileUrlQuery {
  fileId?: string;
  fileIds?: readonly string[];
}

export type AthenaStorageFileDeleteInput = string | readonly string[];

export interface AthenaStorageFileModule {
  delete(
    fileId: string,
    options?: AthenaStorageCallOptions
  ): Promise<StorageFileMutationResponse>;
  delete(
    fileIds: readonly string[],
    options?: AthenaStorageCallOptions
  ): Promise<StorageFileMutationResponse[]>;
  download(
    fileId: string,
    query?: GetStorageFileUrlQuery,
    options?: AthenaStorageBinaryCallOptions
  ): Promise<Response>;
  download(
    fileIds: readonly string[],
    query?: GetStorageFileUrlQuery,
    options?: AthenaStorageBinaryCallOptions
  ): Promise<Response[]>;
  download(
    input: AthenaStorageFileDownloadInput,
    options?: AthenaStorageBinaryCallOptions
  ): Promise<Response | Response[]>;
  list: (
    input: AthenaStorageFileListInput,
    options?: AthenaStorageCallOptions
  ) => Promise<StorageListFilesResponse>;
  upload: (
    input: AthenaStorageFileUploadInput,
    options?: AthenaStorageCallOptions
  ) => Promise<AthenaStorageFileUploadResult>;
  uploadMultipart: (
    input: AthenaStorageFileUploadInput,
    options?: AthenaStorageCallOptions
  ) => Promise<AthenaStorageFileUploadResult>;
}

export interface AthenaStorageFileBaseModule {
  createStorageUploadUrl: (
    input: CreateStorageUploadUrlRequest,
    options?: AthenaStorageCallOptions
  ) => Promise<StorageUploadUrlResponse>;
  createStorageUploadUrls: (
    input: { files: CreateStorageUploadUrlRequest[] },
    options?: AthenaStorageCallOptions
  ) => Promise<StorageBatchUploadUrlResponse>;
  deleteStorageFile: (
    fileId: string,
    options?: AthenaStorageCallOptions
  ) => Promise<StorageFileMutationResponse>;
  getStorageFileProxy: (
    fileId: string,
    query?: GetStorageFileUrlQuery,
    options?: AthenaStorageBinaryCallOptions
  ) => Promise<Response>;
  listStorageFiles: (
    input: ListStorageFilesRequest,
    options?: AthenaStorageCallOptions
  ) => Promise<StorageListFilesResponse>;
}

export interface AthenaStorageMultipartClient {
  abort: (
    input: StorageMultipartAbortRequest,
    options?: AthenaStorageCallOptions
  ) => Promise<Record<string, unknown>>;
  complete: (
    input: StorageMultipartCompleteRequest,
    options?: AthenaStorageCallOptions
  ) => Promise<StorageFileMutationResponse>;
  create: (
    input: StorageMultipartCreateRequest,
    options?: AthenaStorageCallOptions
  ) => Promise<Record<string, unknown>>;
  signPart: (
    input: StorageMultipartSignPartRequest,
    options?: AthenaStorageCallOptions
  ) => Promise<Record<string, unknown>>;
}

function withoutAbortSignal(
  options?: AthenaStorageCallOptions
): AthenaStorageCallOptions | undefined {
  if (!options) {
    return undefined;
  }
  const cleanupOptions = { ...options };
  delete cleanupOptions.signal;
  return cleanupOptions;
}

interface NormalizedUploadSource {
  contentType?: string;
  fileName: string;
  sizeBytes: number;
  source: AthenaStorageUploadSource;
}

interface ResolvedUploadSource extends NormalizedUploadSource {
  fileIndex: number;
  storageKey: string;
}

interface ResolvedUploadRequest {
  source: ResolvedUploadSource;
  uploadRequest: CreateStorageUploadUrlRequest;
}

interface UploadProgressContext {
  aggregateLoaded: number[];
  preparingReported: boolean;
  sources: NormalizedUploadSource[];
}

function mergeUploadHeaders(
  serverHeaders: Record<string, string>,
  inputHeaders: AthenaStorageUploadHeaders | undefined
): Record<string, string> {
  const headers: Record<string, string> = { ...serverHeaders };
  new Headers(inputHeaders).forEach((value, key) => {
    headers[key] = value;
  });
  return headers;
}

export function createStorageFileModule(
  base: AthenaStorageFileBaseModule,
  config: AthenaStorageFileConfig = {},
  multipart?: AthenaStorageMultipartClient
): AthenaStorageFileModule {
  const recoverUploadError = (
    error: unknown,
    uploaded: readonly AthenaStorageUploadedFile[],
    cleanupErrors: readonly unknown[]
  ) => {
    const failure = error instanceof Error ? error : new Error(String(error));
    const recovery = {
      cleanupErrors: [...cleanupErrors],
      completedFiles: [...uploaded],
      uploaded: uploaded.map((file) => file.storage_key),
    };
    try {
      Object.assign(failure, recovery);
      return failure;
    } catch {
      return Object.assign(new Error(failure.message), recovery);
    }
  };

  const uploadIndexes = new WeakMap<AthenaStorageUploadedFile, number>();
  const orderUploadedFiles = (files: readonly AthenaStorageUploadedFile[]) =>
    [...files].sort(
      (left, right) =>
        (uploadIndexes.get(left) ?? 0) - (uploadIndexes.get(right) ?? 0)
    );
  const createProgressContext = (
    sources: NormalizedUploadSource[]
  ): UploadProgressContext => ({
    aggregateLoaded: new Array(sources.length).fill(0) as number[],
    preparingReported: false,
    sources,
  });
  const reportPreparing = (
    input: AthenaStorageFileUploadInput,
    progress: UploadProgressContext
  ) => {
    if (progress.preparingReported) {
      return;
    }
    progress.preparingReported = true;
    input.onProgress?.(
      createProgressSnapshot(
        "preparing",
        progress.sources,
        0,
        0,
        sum(progress.aggregateLoaded)
      )
    );
  };
  const reportProgress = (
    input: AthenaStorageFileUploadInput,
    progress: UploadProgressContext,
    phase: AthenaStorageUploadProgress["phase"],
    fileIndex: number,
    loaded: number,
    multipartInfo?: AthenaStorageUploadProgress["multipart"]
  ) => {
    progress.aggregateLoaded[fileIndex] = loaded;
    input.onProgress?.(
      createProgressSnapshot(
        phase,
        progress.sources,
        fileIndex,
        loaded,
        sum(progress.aggregateLoaded),
        multipartInfo
      )
    );
  };

  const uploadSinglePut = async (
    input: AthenaStorageFileUploadInput,
    sources: ResolvedUploadSource[],
    options: AthenaStorageCallOptions | undefined,
    progress: UploadProgressContext
  ): Promise<AthenaStorageFileUploadResult> => {
    const cleanupOptions = withoutAbortSignal(options);
    const uploadRequests = sources.map(
      (source): ResolvedUploadRequest => ({
        source,
        uploadRequest: {
          bucket: input.bucket,
          bucket_key_enabled: input.bucket_key_enabled,
          content_type: input.content_type ?? source.contentType,
          kms_key_id: input.kms_key_id,
          metadata: input.metadata,
          mime_type: input.mime_type ?? source.contentType,
          name: input.name ?? source.fileName,
          original_name: input.original_name ?? source.fileName,
          public: input.public,
          resource_id: input.resource_id ?? input.resourceId,
          s3_id: input.s3_id ?? "",
          server_side_encryption: input.server_side_encryption,
          size_bytes: source.sizeBytes,
          sse: input.sse,
          ssekms_key_id: input.ssekms_key_id,
          storage_key: source.storageKey,
        },
      })
    );

    reportPreparing(input, progress);

    const uploadUrls =
      uploadRequests.length === 1
        ? [
            await base.createStorageUploadUrl(
              uploadRequests[0].uploadRequest,
              options
            ),
          ]
        : (
            await base.createStorageUploadUrls(
              { files: uploadRequests.map((request) => request.uploadRequest) },
              options
            )
          ).files;

    const uploaded: AthenaStorageUploadedFile[] = [];
    try {
      if (uploadUrls.length !== uploadRequests.length) {
        throw new Error(
          "Storage upload URL batch did not match the requested files"
        );
      }
      for (let index = 0; index < uploadRequests.length; index += 1) {
        const request = uploadRequests[index];
        const uploadUrl = uploadUrls[index];
        if (!(request && uploadUrl)) {
          throw new Error(`Storage upload URL missing for file ${index + 1}`);
        }
        const aggregateProgress = (uploadProgress: { loaded: number }) => {
          reportProgress(
            input,
            progress,
            "uploading",
            request.source.fileIndex,
            uploadProgress.loaded
          );
        };
        const response = config.directUpload
          ? await putDirectStorageUploadBody(
              config.directUpload,
              uploadUrl.upload.bucket,
              uploadUrl.upload.storage_key,
              request.source.source,
              mergeUploadHeaders(
                uploadUrl.upload.headers ?? {},
                input.uploadHeaders
              ),
              options?.signal,
              aggregateProgress
            )
          : await putUploadBody(
              uploadUrl.upload.url,
              uploadUrl.upload.headers ?? {},
              request.source,
              input,
              options,
              aggregateProgress
            );
        const completedFile: AthenaStorageUploadedFile = {
          file: uploadUrl.file,
          fileName: request.source.fileName,
          response,
          source: request.source.source,
          storage_key: request.uploadRequest.storage_key,
          upload: uploadUrl.upload,
        };
        uploadIndexes.set(completedFile, request.source.fileIndex);
        uploaded.push(completedFile);
        reportProgress(
          input,
          progress,
          "complete",
          request.source.fileIndex,
          request.source.sizeBytes
        );
      }
    } catch (error) {
      const cleanupErrors: unknown[] = [];
      for (const pending of uploadUrls.slice(uploaded.length)) {
        try {
          await base.deleteStorageFile(pending.file.id, cleanupOptions);
        } catch (cleanupError) {
          cleanupErrors.push(cleanupError);
        }
      }
      throw recoverUploadError(error, uploaded, cleanupErrors);
    }

    return {
      count: uploaded.length,
      files: uploaded,
    };
  };

  const uploadMultipartResolved = async (
    input: AthenaStorageFileUploadInput,
    sources: ResolvedUploadSource[],
    options: AthenaStorageCallOptions | undefined,
    progressContext: UploadProgressContext
  ) => {
    if (!multipart) {
      throw new Error(
        "athena.storage.file.uploadMultipart requires the multipart namespace"
      );
    }
    const cleanupOptions = withoutAbortSignal(options);
    const partSize = Math.max(
      input.multipartPartSizeBytes ?? DEFAULT_MULTIPART_PART_SIZE_BYTES,
      MIN_MULTIPART_PART_SIZE_BYTES
    );

    reportPreparing(input, progressContext);

    const uploaded: AthenaStorageUploadedFile[] = [];

    for (const source of sources) {
      const storageKey = source.storageKey;
      let pendingFileId: string | undefined;
      let uploadId = "";
      let completed = false;
      try {
        const uploadUrl = await base.createStorageUploadUrl(
          {
            bucket: input.bucket,
            bucket_key_enabled: input.bucket_key_enabled,
            content_type: input.content_type ?? source.contentType,
            kms_key_id: input.kms_key_id,
            metadata: input.metadata,
            mime_type: input.mime_type ?? source.contentType,
            name: input.name ?? source.fileName,
            original_name: input.original_name ?? source.fileName,
            public: input.public,
            resource_id: input.resource_id ?? input.resourceId,
            s3_id: input.s3_id ?? "",
            server_side_encryption: input.server_side_encryption,
            size_bytes: source.sizeBytes,
            sse: input.sse,
            ssekms_key_id: input.ssekms_key_id,
            storage_key: storageKey,
          },
          options
        );
        const fileId = uploadUrl.file.id;
        pendingFileId = fileId;
        const created = await multipart.create(
          {
            bucket_key_enabled: input.bucket_key_enabled,
            content_type: input.content_type ?? source.contentType,
            file_id: fileId,
            kms_key_id: input.kms_key_id,
            server_side_encryption: input.server_side_encryption,
            sse: input.sse,
            ssekms_key_id: input.ssekms_key_id,
          },
          options
        );
        uploadId = readStringField(created, ["upload_id", "uploadId"]);
        if (!uploadId) {
          throw new Error(
            "athena.storage.file.uploadMultipart did not receive an upload_id"
          );
        }

        const partCount = Math.max(1, Math.ceil(source.sizeBytes / partSize));
        const completedParts: Array<{ part_number: number; etag: string }> = [];
        let fileLoaded = 0;

        for (let partNumber = 1; partNumber <= partCount; partNumber += 1) {
          const start = (partNumber - 1) * partSize;
          const end = Math.min(start + partSize, source.sizeBytes);
          const chunk = sliceUploadSource(source.source, start, end);
          const signed = await multipart.signPart(
            {
              file_id: fileId,
              part_number: partNumber,
              upload_id: uploadId,
            },
            options
          );
          const partUrl = readStringField(signed, ["url"]);
          if (!partUrl) {
            throw new Error(
              `athena.storage.file.uploadMultipart missing part URL for part ${partNumber}`
            );
          }
          const partHeaders = readHeadersField(signed);
          const response = await putUploadBody(
            partUrl,
            partHeaders,
            {
              contentType: source.contentType,
              fileName: source.fileName,
              sizeBytes: end - start,
              source: chunk,
            },
            input,
            options,
            (partProgress) => {
              reportProgress(
                input,
                progressContext,
                "uploading",
                source.fileIndex,
                fileLoaded + partProgress.loaded,
                {
                  partCount,
                  partNumber,
                  uploadId,
                }
              );
            }
          );
          const etag = extractEtag(response);
          if (!etag) {
            throw new Error(
              `athena.storage.file.uploadMultipart missing ETag for part ${partNumber}`
            );
          }
          completedParts.push({ etag, part_number: partNumber });
          fileLoaded = end;
          reportProgress(
            input,
            progressContext,
            "uploading",
            source.fileIndex,
            fileLoaded,
            {
              partCount,
              partNumber,
              uploadId,
            }
          );
        }

        const completion = await multipart.complete(
          {
            file_id: fileId,
            parts: completedParts,
            upload_id: uploadId,
          },
          options
        );
        completed = true;

        const completedFile: AthenaStorageUploadedFile = {
          file: completion.file ?? uploadUrl.file,
          fileName: source.fileName,
          response: new Response(null, { status: 200 }),
          source: source.source,
          storage_key: storageKey,
          upload: uploadUrl.upload,
        };
        uploadIndexes.set(completedFile, source.fileIndex);
        uploaded.push(completedFile);
        reportProgress(
          input,
          progressContext,
          "complete",
          source.fileIndex,
          source.sizeBytes,
          {
            partCount,
            partNumber: partCount,
            uploadId,
          }
        );
      } catch (error) {
        const cleanupErrors: unknown[] = [];
        if (!completed && pendingFileId && uploadId) {
          try {
            await multipart.abort(
              { file_id: pendingFileId, upload_id: uploadId },
              cleanupOptions
            );
          } catch (cleanupError) {
            cleanupErrors.push(cleanupError);
            // Best-effort abort; surface the original upload error.
          }
        }
        if (!completed && pendingFileId) {
          try {
            await base.deleteStorageFile(pendingFileId, cleanupOptions);
          } catch (cleanupError) {
            cleanupErrors.push(cleanupError);
          }
        }
        throw recoverUploadError(error, uploaded, cleanupErrors);
      }
    }

    return {
      count: uploaded.length,
      files: uploaded,
    };
  };

  const uploadMultipart: AthenaStorageFileModule["uploadMultipart"] = async (
    input,
    options
  ) => {
    if (!multipart) {
      throw new Error(
        "athena.storage.file.uploadMultipart requires the multipart namespace"
      );
    }
    const sources = normalizeUploadSources(input);
    validateUploadConstraints(sources, input);
    return uploadMultipartResolved(
      input,
      resolveUploadSources(input, sources, options, config),
      options,
      createProgressContext(sources)
    );
  };

  const upload: AthenaStorageFileModule["upload"] = async (input, options) => {
    const sources = normalizeUploadSources(input);
    validateUploadConstraints(sources, input);
    const resolvedSources = resolveUploadSources(
      input,
      sources,
      options,
      config
    );
    const progress = createProgressContext(sources);

    const threshold =
      input.multipartThresholdBytes ?? DEFAULT_MULTIPART_THRESHOLD_BYTES;
    const useMultipart =
      Boolean(multipart) &&
      !input.forceSinglePut &&
      (input.forceMultipart ||
        sources.some((source) => source.sizeBytes >= threshold));

    if (useMultipart) {
      const multipartSources = resolvedSources.filter(
        (source) => input.forceMultipart || source.sizeBytes >= threshold
      );
      const singleSources = resolvedSources.filter(
        (source) => !(input.forceMultipart || source.sizeBytes >= threshold)
      );

      if (multipartSources.length === resolvedSources.length) {
        return uploadMultipartResolved(
          input,
          multipartSources,
          options,
          progress
        );
      }

      // Mixed batch: upload large files via multipart, small via single PUT.
      let multipartResult: AthenaStorageFileUploadResult = {
        count: 0,
        files: [],
      };
      if (multipartSources.length > 0) {
        try {
          multipartResult = await uploadMultipartResolved(
            input,
            multipartSources,
            options,
            progress
          );
        } catch (error) {
          const failure = error as Error & {
            cleanupErrors?: unknown[];
            completedFiles?: AthenaStorageUploadedFile[];
          };
          throw recoverUploadError(
            error,
            orderUploadedFiles(failure.completedFiles ?? []),
            failure.cleanupErrors ?? []
          );
        }
      }
      let singleResult: AthenaStorageFileUploadResult = {
        count: 0,
        files: [],
      };
      if (singleSources.length > 0) {
        try {
          singleResult = await uploadSinglePut(
            input,
            singleSources,
            options,
            progress
          );
        } catch (error) {
          const failure = error as Error & {
            cleanupErrors?: unknown[];
            completedFiles?: AthenaStorageUploadedFile[];
          };
          throw recoverUploadError(
            error,
            orderUploadedFiles([
              ...multipartResult.files,
              ...(failure.completedFiles ?? []),
            ]),
            failure.cleanupErrors ?? []
          );
        }
      }
      const files = orderUploadedFiles([
        ...multipartResult.files,
        ...singleResult.files,
      ]);
      return { count: files.length, files };
    }

    return uploadSinglePut(input, resolvedSources, options, progress);
  };

  const download = ((
    input: string | readonly string[] | AthenaStorageFileDownloadInput,
    queryOrOptions?: GetStorageFileUrlQuery | AthenaStorageBinaryCallOptions,
    maybeOptions?: AthenaStorageBinaryCallOptions
  ): Promise<Response | Response[]> => {
    const { fileIds, query, options } = normalizeDownloadArgs(
      input,
      queryOrOptions,
      maybeOptions
    );
    const downloads = fileIds.map((fileId) =>
      base.getStorageFileProxy(fileId, query, options)
    );
    return Array.isArray(input) ||
      (isRecord(input) && Array.isArray(input.fileIds))
      ? Promise.all(downloads)
      : downloads[0];
  }) as AthenaStorageFileModule["download"];

  const deleteFile = ((
    input: string | readonly string[],
    options?: AthenaStorageCallOptions
  ): Promise<StorageFileMutationResponse | StorageFileMutationResponse[]> => {
    if (Array.isArray(input)) {
      return Promise.all(
        input.map((fileId) => base.deleteStorageFile(fileId, options))
      );
    }
    return base.deleteStorageFile(input as string, options);
  }) as AthenaStorageFileModule["delete"];

  return {
    delete: deleteFile,
    download,

    list(input, options) {
      const prefix = resolveStoragePath(
        input.prefix ?? "",
        input,
        options,
        config
      );
      // Strip path-templating helpers; forward every ListStorageFilesRequest field.
      const {
        env: _env,
        organization_id: _organization_id,
        organizationId: _organizationId,
        prefix: _prefix,
        prefixPath: _prefixPath,
        resourceId: _resourceId,
        user_id: _user_id,
        userId: _userId,
        vars: _vars,
        ...listRequest
      } = input;
      return base.listStorageFiles(
        {
          ...listRequest,
          prefix,
          s3_id: input.s3_id ?? "",
        },
        options
      );
    },
    upload,
    uploadMultipart,
  };
}

export function resolveStoragePath(
  path: string,
  input: {
    prefixPath?: AthenaStoragePrefixPath;
    vars?: AthenaStorageTemplateVars;
    env?: AthenaStorageEnv;
    organization_id?: string;
    organizationId?: string;
    user_id?: string;
    userId?: string;
    resource_id?: string;
    resourceId?: string;
  },
  options: AthenaStorageCallOptions | undefined,
  config: AthenaStorageFileConfig = {}
): string {
  const context = createPathContext(input, options, config);
  const prefixPath = input.prefixPath ?? config.prefixPath;
  const prefix =
    typeof prefixPath === "function" ? prefixPath(context) : prefixPath;
  return joinStoragePath(
    renderStorageTemplate(prefix ?? "", context),
    renderStorageTemplate(path, context)
  );
}

function resolveUploadStorageKey(
  input: AthenaStorageFileUploadInput,
  source: NormalizedUploadSource,
  index: number,
  options: AthenaStorageCallOptions | undefined,
  config: AthenaStorageFileConfig
): string {
  const explicitKey = input.storage_key ?? input.storageKey;
  const keyTemplate = input.storageKeyTemplate;
  const fallbackName = source.fileName;
  const context = createPathContext(input, options, config);
  const key = keyTemplate
    ? renderStorageTemplate(keyTemplate, {
        ...context,
        vars: {
          ...context.vars,
          fileName: source.fileName,
          index,
          name: source.fileName,
        },
      })
    : (explicitKey ?? fallbackName);
  return resolveStoragePath(key, input, options, config);
}

function resolveUploadSources(
  input: AthenaStorageFileUploadInput,
  sources: readonly NormalizedUploadSource[],
  options: AthenaStorageCallOptions | undefined,
  config: AthenaStorageFileConfig
): ResolvedUploadSource[] {
  return sources.map((source, fileIndex) => ({
    ...source,
    fileIndex,
    storageKey: resolveUploadStorageKey(
      input,
      source,
      fileIndex,
      options,
      config
    ),
  }));
}

function normalizeUploadSources(
  input: AthenaStorageFileUploadInput
): NormalizedUploadSource[] {
  const files = toArray(input.files);
  if (files.length === 0) {
    throw new Error("athena.storage.file.upload requires at least one file");
  }
  return files.map((source, index) => {
    const fileName =
      input.fileName ?? sourceName(source) ?? `file-${index + 1}`;
    const sizeBytes = sourceSize(source);
    const contentType =
      input.content_type ?? input.mime_type ?? sourceContentType(source);
    return {
      contentType,
      fileName,
      sizeBytes,
      source,
    };
  });
}

function validateUploadConstraints(
  sources: readonly NormalizedUploadSource[],
  input: AthenaStorageFileUploadInput
): void {
  const maxFiles = input.maxFiles ?? 1;
  if (sources.length > maxFiles) {
    throw new Error(
      `athena.storage.file.upload accepts at most ${maxFiles} file${maxFiles === 1 ? "" : "s"} for this call`
    );
  }

  const maxFileSizeBytes =
    input.maxFileSizeBytes ??
    (input.maxFileSizeMb === undefined
      ? undefined
      : Math.floor(input.maxFileSizeMb * 1024 * 1024));
  if (maxFileSizeBytes !== undefined) {
    const tooLarge = sources.find(
      (source) => source.sizeBytes > maxFileSizeBytes
    );
    if (tooLarge) {
      throw new Error(
        `athena.storage.file.upload rejected ${tooLarge.fileName}: file exceeds ${maxFileSizeBytes} bytes`
      );
    }
  }

  const allowedExtensions = normalizeExtensions(
    input.allowedExtensions ?? input.extensions
  );
  if (allowedExtensions.size > 0) {
    const invalid = sources.find(
      (source) => !allowedExtensions.has(fileExtension(source.fileName))
    );
    if (invalid) {
      throw new Error(
        `athena.storage.file.upload rejected ${invalid.fileName}: extension is not allowed`
      );
    }
  }
}

async function putUploadBody(
  url: string,
  uploadHeaders: Record<string, string>,
  source: NormalizedUploadSource,
  input: AthenaStorageFileUploadInput,
  options: AthenaStorageCallOptions | undefined,
  onProgress: (progress: { loaded: number }) => void
): Promise<Response> {
  const headers = new Headers(uploadHeaders);
  new Headers(input.uploadHeaders).forEach((value, key) => {
    headers.set(key, value);
  });
  if (source.contentType && !headers.has("Content-Type")) {
    headers.set("Content-Type", source.contentType);
  }
  if (canUseStorageXhrPut()) {
    return putStorageBodyWithXhr({
      body: source.source as AthenaStorageXhrPutBody,
      completeLoaded: source.sizeBytes,
      headers,
      onProgress,
      operationLabel: "athena.storage.file.upload",
      signal: options?.signal,
      url,
    });
  }
  onProgress({ loaded: 0 });
  const response = await fetch(url, {
    body: source.source as RequestInit["body"],
    headers,
    method: "PUT",
    signal: options?.signal,
  });
  if (!response.ok) {
    throw new Error(
      `athena.storage.file.upload failed with status ${response.status}`
    );
  }
  onProgress({ loaded: source.sizeBytes });
  return response;
}

function normalizeDownloadArgs(
  input: string | readonly string[] | AthenaStorageFileDownloadInput,
  queryOrOptions?: GetStorageFileUrlQuery | AthenaStorageBinaryCallOptions,
  maybeOptions?: AthenaStorageBinaryCallOptions
): {
  fileIds: string[];
  query?: GetStorageFileUrlQuery;
  options?: AthenaStorageBinaryCallOptions;
} {
  if (typeof input === "string") {
    return {
      fileIds: [input],
      options: maybeOptions,
      query: queryOrOptions as GetStorageFileUrlQuery | undefined,
    };
  }
  if (Array.isArray(input)) {
    return {
      fileIds: [...input],
      options: maybeOptions,
      query: queryOrOptions as GetStorageFileUrlQuery | undefined,
    };
  }
  const downloadInput = input as AthenaStorageFileDownloadInput;
  const { fileId, fileIds, ...query } = downloadInput;
  return {
    fileIds: fileIds ? [...fileIds] : fileId ? [fileId] : [],
    options: queryOrOptions as AthenaStorageBinaryCallOptions | undefined,
    query,
  };
}

function createPathContext(
  input: {
    vars?: AthenaStorageTemplateVars;
    env?: AthenaStorageEnv;
    organization_id?: string;
    organizationId?: string;
    user_id?: string;
    userId?: string;
    resource_id?: string;
    resourceId?: string;
  },
  options: AthenaStorageCallOptions | undefined,
  config: AthenaStorageFileConfig
): AthenaStoragePathContext {
  const organizationId =
    input.organizationId ??
    input.organization_id ??
    options?.organizationId ??
    undefined;
  const userId = input.userId ?? input.user_id ?? options?.userId ?? undefined;
  const resourceId = input.resourceId ?? input.resource_id ?? undefined;
  const vars = {
    ...(config.vars ?? {}),
    ...(input.vars ?? {}),
  };
  if (organizationId !== undefined) {
    vars.organizationId = organizationId;
    vars.organization_id = organizationId;
  }
  if (userId !== undefined) {
    vars.userId = userId;
    vars.user_id = userId;
  }
  if (resourceId !== undefined) {
    vars.resourceId = resourceId;
    vars.resource_id = resourceId;
  }
  return {
    env: {
      ...readProcessEnv(),
      ...(config.env ?? {}),
      ...(input.env ?? {}),
    },
    organization_id: organizationId,
    organizationId,
    resource_id: resourceId,
    resourceId,
    user_id: userId,
    userId,
    vars,
  };
}

function renderStorageTemplate(
  template: string,
  context: AthenaStoragePathContext
): string {
  return template.replace(
    /\$\{([^}]+)\}|\{([^}]+)\}/g,
    (
      _match,
      shellToken: string | undefined,
      braceToken: string | undefined
    ) => {
      const token = (shellToken ?? braceToken ?? "").trim();
      if (!token) {
        return "";
      }
      const value = resolveTemplateToken(token, context);
      return value === undefined || value === null ? "" : String(value);
    }
  );
}

function resolveTemplateToken(
  token: string,
  context: AthenaStoragePathContext
): AthenaStorageTemplateValue {
  if (token.startsWith("env.")) {
    return context.env[token.slice(4)];
  }
  if (token in context.vars) {
    return context.vars[token];
  }
  return context.env[token];
}

function joinStoragePath(...parts: readonly string[]): string {
  return parts
    .map((part) => part.trim().replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .join("/");
}

function toArray(
  files: AthenaStorageFileUploadInput["files"]
): AthenaStorageUploadSource[] {
  if (isUploadSource(files)) {
    return [files];
  }
  return Array.from(files);
}

function isUploadSource(value: unknown): value is AthenaStorageUploadSource {
  return (
    value instanceof Blob ||
    value instanceof ArrayBuffer ||
    value instanceof Uint8Array
  );
}

function sourceName(source: AthenaStorageUploadSource): string | undefined {
  return isRecord(source) &&
    typeof source.name === "string" &&
    source.name.trim()
    ? source.name.trim()
    : undefined;
}

function sourceSize(source: AthenaStorageUploadSource): number {
  if (source instanceof Blob) {
    return source.size;
  }
  return source.byteLength;
}

function sourceContentType(
  source: AthenaStorageUploadSource
): string | undefined {
  return source instanceof Blob && source.type.trim()
    ? source.type.trim()
    : undefined;
}

function normalizeExtensions(
  extensions: readonly string[] | undefined
): Set<string> {
  return new Set(
    (extensions ?? [])
      .map((extension) => extension.replace(/^\./, "").toLowerCase())
      .filter(Boolean)
  );
}

function fileExtension(fileName: string): string {
  const lastDot = fileName.lastIndexOf(".");
  return lastDot === -1 ? "" : fileName.slice(lastDot + 1).toLowerCase();
}

function createProgressSnapshot(
  phase: AthenaStorageUploadProgress["phase"],
  sources: readonly NormalizedUploadSource[],
  fileIndex: number,
  loaded: number,
  aggregateLoaded: number,
  multipartInfo?: AthenaStorageUploadProgress["multipart"]
): AthenaStorageUploadProgress {
  const total = sources[fileIndex]?.sizeBytes ?? 0;
  const aggregateTotal = sources.reduce(
    (totalBytes, source) => totalBytes + source.sizeBytes,
    0
  );
  return {
    aggregateLoaded,
    aggregatePercent:
      aggregateTotal > 0
        ? Math.round((aggregateLoaded / aggregateTotal) * 100)
        : 100,
    aggregateTotal,
    fileCount: sources.length,
    fileIndex,
    fileName: sources[fileIndex]?.fileName ?? "",
    loaded,
    percent: total > 0 ? Math.round((loaded / total) * 100) : 100,
    phase,
    total,
    ...(multipartInfo ? { multipart: multipartInfo } : {}),
  };
}

function sliceUploadSource(
  source: AthenaStorageUploadSource,
  start: number,
  end: number
): AthenaStorageUploadSource {
  if (source instanceof Blob) {
    return source.slice(start, end);
  }
  if (source instanceof ArrayBuffer) {
    return source.slice(start, end);
  }
  return source.slice(start, end);
}

function readStringField(value: unknown, keys: readonly string[]): string {
  if (!isRecord(value)) {
    return "";
  }
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return "";
}

function readHeadersField(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    return {};
  }
  const headers = value.headers;
  if (!isRecord(headers)) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const [key, headerValue] of Object.entries(headers)) {
    if (typeof headerValue === "string") {
      result[key] = headerValue;
    }
  }
  return result;
}

function extractEtag(response: Response): string {
  const etag =
    response.headers.get("etag") ?? response.headers.get("ETag") ?? "";
  return etag.trim();
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function readProcessEnv(): AthenaStorageEnv {
  const processLike = (globalThis as { process?: { env?: AthenaStorageEnv } })
    .process;
  return processLike?.env ?? {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}
