import type { AthenaGatewayClient } from "../gateway/client.ts";
import { isAthenaGatewayError } from "../gateway/errors.ts";
import type {
  AthenaGatewayCallOptions,
  AthenaGatewayEndpointPath,
  AthenaGatewayMethod,
} from "../gateway/types.ts";
import {
  buildAthenaGatewayUrl,
  normalizeAthenaGatewayBaseUrl,
} from "../gateway/url.ts";
import { appendHttpQuery as appendQuery } from "../http/append-query.ts";
import { parseHttpResponseBody as parseResponseBody } from "../http/parse-response-body.ts";
import type { AthenaStorageBackupNamespace } from "./backup.ts";
import { createStorageBackupModule } from "./backup.ts";
import {
  type AthenaStorageErrorCode,
  type AthenaStorageErrorHandler,
  bindStorageErrorRoutes,
  rejectStorageError,
} from "./errors.ts";
import type {
  AthenaStorageFileConfig,
  AthenaStorageFileModule,
} from "./file.ts";
import { createStorageFileModule } from "./file.ts";
import storageLiveHttpRoutesDocument from "./live-http-routes.json";

export type {
  AthenaStorageBackupNamespace,
  BackupRecoveryStrategy,
  StorageBackupCreateRequest,
  StorageBackupJob,
  StorageBackupListPage,
  StorageBackupListQuery,
  StorageBackupQueuedJob,
  StorageBackupRecord,
  StorageBackupRestoreRequest,
  StorageBackupSchedule,
  StorageBackupScheduleCreateRequest,
} from "./backup.ts";
export type {
  AthenaStorageErrorDetails,
  AthenaStorageErrorHandler,
  AthenaStorageErrorInput,
} from "./errors.ts";
export {
  AthenaStorageError,
  AthenaStorageErrorCode,
  createAthenaStorageError,
} from "./errors.ts";

/**
 * Live storage METHOD+path inventory (billing-style contract spine).
 * Exact-set parity with `storageSdkManifest` is enforced in
 * `test/storage-route-parity.test.ts`. Keep this JSON and the manifest table
 * in lockstep when adding routes — never shrink product routes to match a thin list.
 */
export const storageLiveHttpRoutes = storageLiveHttpRoutesDocument;

/**
 * Storage SDK route table (SSOT for method names, METHOD+path, envelope).
 * Thin JSON routes in `createStorageModule` resolve path/method/envelope via
 * `requireStorageManifestRoute` / `callManifestRoute` so wrappers cannot drift.
 * Binary, multipart upload bodies, dual-visibility verbs, and admin backup
 * helpers keep specialized implementations.
 */
export const storageSdkManifest = {
  basePath: "/storage",
  envelopeKinds: {
    athena: "response body is { status, message, data }",
    raw: "response body is the payload",
  },
  methods: [
    {
      method: "GET",
      name: "listCanonicalStorageProviders",
      path: "/storage/providers",
      responseEnvelope: "athena",
      responseType: "{ providers: StorageProviderDescriptor[] }",
    },
    {
      method: "GET",
      name: "listCanonicalStorageConnections",
      path: "/storage/connections",
      responseEnvelope: "athena",
      responseType: "{ connections: StorageConnection[] }",
    },
    {
      method: "POST",
      name: "createCanonicalStorageConnection",
      path: "/storage/connections",
      requestType: "CreateStorageConnectionInput",
      responseEnvelope: "athena",
      responseType: "{ connection: StorageConnection }",
    },
    {
      method: "POST",
      name: "testCanonicalStorageConnection",
      path: "/storage/connections/test",
      requestType: "TestStorageConnectionInput",
      responseEnvelope: "athena",
      responseType: "{ ok: boolean; config: PublicStorageConnectionConfig }",
    },
    {
      method: "GET",
      name: "getCanonicalStorageConnection",
      path: "/storage/connections/{id}",
      pathParams: ["id"],
      responseEnvelope: "athena",
      responseType: "{ connection: StorageConnection }",
    },
    {
      method: "DELETE",
      name: "deleteCanonicalStorageConnection",
      path: "/storage/connections/{id}",
      pathParams: ["id"],
      responseEnvelope: "athena",
      responseType: "{ connectionId: string }",
    },
    {
      method: "POST",
      name: "uploadCanonicalStorageFile",
      path: "/storage/service/files",
      requestType: "UploadManagedFileInput",
      responseEnvelope: "athena",
      responseType: "{ file: ManagedFile }",
    },
    {
      method: "POST",
      name: "listCanonicalStorageFiles",
      path: "/storage/service/files/list",
      requestType: "ListManagedFilesInput",
      responseEnvelope: "athena",
      responseType: "{ files: ManagedFile[] }",
    },
    {
      method: "GET",
      name: "getCanonicalStorageFile",
      path: "/storage/service/files/{file_id}",
      pathParams: ["file_id"],
      responseEnvelope: "athena",
      responseType: "{ file: ManagedFile }",
    },
    {
      method: "DELETE",
      name: "deleteCanonicalStorageFile",
      path: "/storage/service/files/{file_id}",
      pathParams: ["file_id"],
      responseEnvelope: "athena",
      responseType: "{ file: ManagedFile }",
    },
    {
      method: "POST",
      name: "moveCanonicalStorageFile",
      path: "/storage/service/files/{file_id}/move",
      pathParams: ["file_id"],
      requestType: "MoveManagedFileInput",
      responseEnvelope: "athena",
      responseType: "{ file: ManagedFile }",
    },
    {
      method: "POST",
      name: "restoreCanonicalStorageFile",
      path: "/storage/service/files/{file_id}/restore",
      pathParams: ["file_id"],
      responseEnvelope: "athena",
      responseType: "{ file: ManagedFile }",
    },
    {
      method: "DELETE",
      name: "purgeCanonicalStorageFile",
      path: "/storage/service/files/{file_id}/purge",
      pathParams: ["file_id"],
      responseEnvelope: "athena",
      responseType: "{ fileId: string }",
    },
    {
      method: "POST",
      name: "setCanonicalStorageFileVisibility",
      path: "/storage/service/files/{file_id}/visibility",
      pathParams: ["file_id"],
      requestType: "SetManagedFileVisibilityInput",
      responseEnvelope: "athena",
      responseType: "{ file: ManagedFile }",
    },
    {
      method: "GET",
      name: "listCanonicalStoragePermissions",
      path: "/storage/service/files/{file_id}/permissions",
      pathParams: ["file_id"],
      responseEnvelope: "athena",
      responseType: "{ permissions: FilePermission[] }",
    },
    {
      method: "POST",
      name: "grantCanonicalStoragePermission",
      path: "/storage/service/files/{file_id}/permissions/grant",
      pathParams: ["file_id"],
      requestType: "GrantFilePermissionInput",
      responseEnvelope: "athena",
      responseType: "{ permission: FilePermission }",
    },
    {
      method: "POST",
      name: "revokeCanonicalStoragePermission",
      path: "/storage/service/files/{file_id}/permissions/revoke",
      pathParams: ["file_id"],
      requestType: "RevokeFilePermissionInput",
      responseEnvelope: "athena",
      responseType: "{ fileId: string }",
    },
    {
      method: "GET",
      name: "listStorageCatalogs",
      path: "/storage/catalogs",
      responseEnvelope: "raw",
      responseType: "{ data: S3CatalogItem[] }",
    },
    {
      method: "POST",
      name: "createStorageCatalog",
      path: "/storage/catalogs",
      requestType: "CreateStorageCatalogRequest",
      responseEnvelope: "raw",
      responseType: "S3CatalogItem",
    },
    {
      method: "PATCH",
      name: "updateStorageCatalog",
      path: "/storage/catalogs/{id}",
      pathParams: ["id"],
      requestType: "UpdateStorageCatalogRequest",
      responseEnvelope: "raw",
      responseType: "S3CatalogItem",
    },
    {
      method: "DELETE",
      name: "deleteStorageCatalog",
      path: "/storage/catalogs/{id}",
      pathParams: ["id"],
      responseEnvelope: "raw",
      responseType: "{ id: string; deleted: boolean }",
    },
    {
      method: "GET",
      name: "listStorageCredentials",
      path: "/storage/credentials",
      responseEnvelope: "raw",
      responseType: "{ data: S3CredentialListItem[] }",
    },
    {
      method: "GET",
      name: "backup.list",
      note: "Admin backup archives on server S3/R2 profile",
      path: "/admin/backups",
      responseEnvelope: "athena",
      responseType: "StorageBackupListPage",
    },
    {
      method: "POST",
      name: "backup.create",
      path: "/admin/backups",
      requestType: "StorageBackupCreateRequest",
      responseEnvelope: "athena",
      responseType: "StorageBackupQueuedJob",
    },
    {
      method: "POST",
      name: "backup.restore",
      path: "/admin/backups/{key}/restore",
      pathParams: ["key"],
      requestType: "StorageBackupRestoreRequest",
      responseEnvelope: "athena",
      responseType: "StorageBackupQueuedJob",
    },
    {
      method: "DELETE",
      name: "backup.delete",
      path: "/admin/backups/{key}",
      pathParams: ["key"],
      responseEnvelope: "athena",
      responseType: "void",
    },
    {
      method: "GET",
      name: "backup.jobs.list",
      path: "/admin/backups/jobs",
      responseEnvelope: "athena",
      responseType: "StorageBackupJob[]",
    },
    {
      method: "GET",
      name: "backup.schedules.list",
      path: "/admin/backups/schedules",
      responseEnvelope: "athena",
      responseType: "StorageBackupSchedule[]",
    },
    {
      method: "POST",
      name: "createStorageUploadUrl",
      path: "/storage/files/upload-url",
      requestType: "CreateStorageUploadUrlRequest",
      responseEnvelope: "athena",
      responseType: "StorageUploadUrlResponse",
    },
    {
      method: "POST",
      name: "createStorageUploadUrls",
      path: "/storage/files/upload-urls",
      requestType: "CreateStorageUploadUrlsRequest",
      responseEnvelope: "athena",
      responseType: "StorageBatchUploadUrlResponse",
    },
    {
      method: "POST",
      name: "listStorageFiles",
      path: "/storage/files/list",
      requestType: "ListStorageFilesRequest",
      responseEnvelope: "athena",
      responseType: "StorageListFilesResponse",
    },
    {
      method: "GET",
      name: "getStorageFile",
      path: "/storage/files/{file_id}",
      pathParams: ["file_id"],
      responseEnvelope: "athena",
      responseType: "StorageFileMutationResponse",
    },
    {
      method: "GET",
      name: "getStorageFileUrl",
      path: "/storage/files/{file_id}/url",
      pathParams: ["file_id"],
      queryParams: ["purpose"],
      responseEnvelope: "athena",
      responseType: "PresignedFileUrlResponse",
    },
    {
      binary: true,
      method: "GET",
      name: "getStorageFileProxy",
      path: "/storage/files/{file_id}/proxy",
      pathParams: ["file_id"],
      queryParams: ["purpose"],
      responseEnvelope: "raw",
      responseType: "Response",
    },
    {
      method: "PATCH",
      name: "updateStorageFile",
      path: "/storage/files/{file_id}",
      pathParams: ["file_id"],
      requestType: "UpdateStorageFileRequest",
      responseEnvelope: "athena",
      responseType: "StorageFileMutationResponse",
    },
    {
      method: "DELETE",
      name: "deleteStorageFile",
      path: "/storage/files/{file_id}",
      pathParams: ["file_id"],
      responseEnvelope: "athena",
      responseType: "StorageFileMutationResponse",
    },
    {
      method: "PATCH",
      name: "setStorageFileVisibility",
      path: "/storage/files/{file_id}/visibility",
      pathParams: ["file_id"],
      requestType: "SetStorageFileVisibilityRequest",
      responseEnvelope: "athena",
      responseType: "StorageFileMutationResponse",
    },
    {
      method: "POST",
      name: "postStorageFileVisibility",
      path: "/storage/files/{file_id}/visibility",
      pathParams: ["file_id"],
      requestType: "SetStorageFileVisibilityRequest",
      responseEnvelope: "athena",
      responseType: "StorageFileMutationResponse",
    },
    {
      method: "POST",
      name: "setManyStorageFileVisibility",
      path: "/storage/files/visibility-many",
      requestType: "SetManyStorageFileVisibilityRequest",
      responseEnvelope: "athena",
      responseType: "StorageFileMutationManyResponse",
    },
    {
      method: "POST",
      name: "deleteStorageFolder",
      path: "/storage/folders/delete",
      requestType: "DeleteStorageFolderRequest",
      responseEnvelope: "athena",
      responseType: "StorageFolderMutationResponse",
    },
    {
      method: "POST",
      name: "moveStorageFolder",
      path: "/storage/folders/move",
      requestType: "MoveStorageFolderRequest",
      responseEnvelope: "athena",
      responseType: "StorageFolderMutationResponse",
    },
    {
      method: "POST",
      name: "searchStorageFiles",
      path: "/storage/files/search",
      requestType: "SearchStorageFilesRequest",
      responseEnvelope: "athena",
      responseType: "StorageListFilesResponse",
    },
    {
      method: "POST",
      name: "confirmStorageUpload",
      path: "/storage/files/{file_id}/confirm-upload",
      pathParams: ["file_id"],
      requestType: "ConfirmStorageUploadRequest",
      responseEnvelope: "athena",
      responseType: "StorageFileMutationResponse",
    },
    {
      binary: true,
      method: "PUT",
      name: "uploadStorageFileBinary",
      path: "/storage/files/{file_id}/upload",
      pathParams: ["file_id"],
      responseEnvelope: "athena",
      responseType: "StorageFileMutationResponse",
    },
    {
      method: "POST",
      name: "copyStorageFile",
      path: "/storage/files/{file_id}/copy",
      pathParams: ["file_id"],
      requestType: "CopyStorageFileRequest",
      responseEnvelope: "athena",
      responseType: "StorageFileMutationResponse",
    },
    {
      method: "POST",
      name: "deleteManyStorageFiles",
      path: "/storage/files/delete-many",
      requestType: "DeleteManyStorageFilesRequest",
      responseEnvelope: "athena",
      responseType: "StorageFileMutationManyResponse",
    },
    {
      method: "POST",
      name: "updateManyStorageFiles",
      path: "/storage/files/update-many",
      requestType: "UpdateManyStorageFilesRequest",
      responseEnvelope: "athena",
      responseType: "StorageFileMutationManyResponse",
    },
    {
      method: "POST",
      name: "restoreStorageFile",
      path: "/storage/files/{file_id}/restore",
      pathParams: ["file_id"],
      responseEnvelope: "athena",
      responseType: "StorageFileMutationResponse",
    },
    {
      method: "DELETE",
      name: "purgeStorageFile",
      path: "/storage/files/{file_id}/purge",
      pathParams: ["file_id"],
      responseEnvelope: "athena",
      responseType: "StorageFileMutationResponse",
    },
    {
      method: "GET",
      name: "getStorageFilePublicUrl",
      path: "/storage/files/{file_id}/public-url",
      pathParams: ["file_id"],
      responseEnvelope: "athena",
      responseType: "Record<string, unknown>",
    },
    {
      method: "GET",
      name: "getStorageFileProxyUrl",
      path: "/storage/files/{file_id}/proxy-url",
      pathParams: ["file_id"],
      queryParams: ["purpose"],
      responseEnvelope: "athena",
      responseType: "Record<string, unknown>",
    },
    {
      method: "GET",
      name: "listStorageFileVersions",
      path: "/storage/files/{file_id}/versions",
      pathParams: ["file_id"],
      responseEnvelope: "athena",
      responseType: "Record<string, unknown>",
    },
    {
      method: "POST",
      name: "restoreStorageFileVersion",
      path: "/storage/files/{file_id}/versions/{version_id}/restore",
      pathParams: ["file_id", "version_id"],
      responseEnvelope: "athena",
      responseType: "Record<string, unknown>",
    },
    {
      method: "DELETE",
      name: "deleteStorageFileVersion",
      path: "/storage/files/{file_id}/versions/{version_id}",
      pathParams: ["file_id", "version_id"],
      responseEnvelope: "athena",
      responseType: "Record<string, unknown>",
    },
    {
      method: "GET",
      name: "getStorageFileRetention",
      path: "/storage/files/{file_id}/retention",
      pathParams: ["file_id"],
      queryParams: ["version_id"],
      responseEnvelope: "athena",
      responseType: "Record<string, unknown>",
    },
    {
      method: "POST",
      name: "setStorageFileRetention",
      path: "/storage/files/{file_id}/retention",
      pathParams: ["file_id"],
      requestType: "StorageFileRetentionRequest",
      responseEnvelope: "athena",
      responseType: "Record<string, unknown>",
    },
    {
      method: "POST",
      name: "listStorageFolders",
      path: "/storage/folders/list",
      requestType: "ListStorageFoldersRequest",
      responseEnvelope: "athena",
      responseType: "Record<string, unknown>",
    },
    {
      method: "POST",
      name: "treeStorageFolders",
      path: "/storage/folders/tree",
      requestType: "TreeStorageFoldersRequest",
      responseEnvelope: "athena",
      responseType: "Record<string, unknown>",
    },
    {
      method: "POST",
      name: "listStoragePermissions",
      path: "/storage/permissions/list",
      requestType: "StoragePermissionListRequest",
      responseEnvelope: "athena",
      responseType: "StoragePermissionListResponse",
    },
    {
      method: "POST",
      name: "grantStoragePermission",
      path: "/storage/permissions/grant",
      requestType: "StoragePermissionGrantRequest",
      responseEnvelope: "athena",
      responseType: "Record<string, unknown>",
    },
    {
      method: "POST",
      name: "revokeStoragePermission",
      path: "/storage/permissions/revoke",
      requestType: "StoragePermissionRevokeRequest",
      responseEnvelope: "athena",
      responseType: "Record<string, unknown>",
    },
    {
      method: "POST",
      name: "checkStoragePermission",
      path: "/storage/permissions/check",
      requestType: "StoragePermissionCheckRequest",
      responseEnvelope: "athena",
      responseType: "StoragePermissionCheckResponse",
    },
    {
      method: "POST",
      name: "listStorageObjects",
      path: "/storage/objects",
      requestType: "StorageListObjectsRequest",
      responseEnvelope: "athena",
      responseType: "Record<string, unknown>",
    },
    {
      method: "POST",
      name: "headStorageObject",
      path: "/storage/objects/head",
      requestType: "StorageObjectRequest",
      responseEnvelope: "athena",
      responseType: "Record<string, unknown>",
    },
    {
      method: "POST",
      name: "existsStorageObject",
      path: "/storage/objects/exists",
      requestType: "StorageObjectRequest",
      responseEnvelope: "athena",
      responseType: "Record<string, unknown>",
    },
    {
      method: "POST",
      name: "validateStorageObject",
      path: "/storage/objects/validate",
      requestType: "StorageObjectValidateRequest",
      responseEnvelope: "athena",
      responseType: "Record<string, unknown>",
    },
    {
      method: "POST",
      name: "updateStorageObject",
      path: "/storage/objects/update",
      requestType: "StorageUpdateObjectRequest",
      responseEnvelope: "athena",
      responseType: "Record<string, unknown>",
    },
    {
      method: "POST",
      name: "copyStorageObject",
      path: "/storage/objects/copy",
      requestType: "StorageObjectCopyRequest",
      responseEnvelope: "athena",
      responseType: "Record<string, unknown>",
    },
    {
      method: "POST",
      name: "getStorageObjectUrl",
      path: "/storage/objects/url",
      requestType: "StorageObjectRequest",
      responseEnvelope: "athena",
      responseType: "Record<string, unknown>",
    },
    {
      method: "POST",
      name: "getStorageObjectPublicUrl",
      path: "/storage/objects/public-url",
      requestType: "StorageObjectPublicUrlRequest",
      responseEnvelope: "athena",
      responseType: "Record<string, unknown>",
    },
    {
      method: "POST",
      name: "deleteStorageObject",
      path: "/storage/objects/delete",
      requestType: "StorageObjectRequest",
      responseEnvelope: "athena",
      responseType: "Record<string, unknown>",
    },
    {
      method: "POST",
      name: "createStorageObjectUploadUrl",
      path: "/storage/objects/upload-url",
      requestType: "StoragePresignUploadRequest",
      responseEnvelope: "athena",
      responseType: "Record<string, unknown>",
    },
    {
      method: "POST",
      name: "createStorageObjectPostPolicy",
      path: "/storage/objects/post-policy",
      requestType: "StorageSignedPostPolicyRequest",
      responseEnvelope: "athena",
      responseType: "Record<string, unknown>",
    },
    {
      method: "POST",
      name: "listStorageObjectVersions",
      path: "/storage/objects/versions",
      requestType: "StorageObjectVersionListRequest",
      responseEnvelope: "athena",
      responseType: "Record<string, unknown>",
    },
    {
      method: "POST",
      name: "restoreStorageObjectVersion",
      path: "/storage/objects/versions/restore",
      requestType: "StorageObjectVersionMutationRequest",
      responseEnvelope: "athena",
      responseType: "Record<string, unknown>",
    },
    {
      method: "POST",
      name: "deleteStorageObjectVersion",
      path: "/storage/objects/versions/delete",
      requestType: "StorageObjectVersionMutationRequest",
      responseEnvelope: "athena",
      responseType: "Record<string, unknown>",
    },
    {
      method: "POST",
      name: "createStorageObjectFolder",
      path: "/storage/objects/folder",
      requestType: "StorageObjectFolderCreateRequest",
      responseEnvelope: "athena",
      responseType: "Record<string, unknown>",
    },
    {
      method: "POST",
      name: "deleteStorageObjectFolder",
      path: "/storage/objects/folder/delete",
      requestType: "StorageObjectFolderDeleteRequest",
      responseEnvelope: "athena",
      responseType: "Record<string, unknown>",
    },
    {
      method: "POST",
      name: "renameStorageObjectFolder",
      path: "/storage/objects/folder/rename",
      requestType: "StorageObjectFolderRenameRequest",
      responseEnvelope: "athena",
      responseType: "Record<string, unknown>",
    },
    {
      method: "POST",
      name: "listStorageBuckets",
      path: "/storage/buckets/list",
      requestType: "Omit<StorageObjectBaseRequest, 'bucket'>",
      responseEnvelope: "athena",
      responseType: "Record<string, unknown>",
    },
    {
      method: "POST",
      name: "createStorageBucket",
      path: "/storage/buckets/create",
      requestType: "StorageObjectBaseRequest",
      responseEnvelope: "athena",
      responseType: "Record<string, unknown>",
    },
    {
      method: "POST",
      name: "deleteStorageBucket",
      path: "/storage/buckets/delete",
      requestType: "StorageObjectBaseRequest",
      responseEnvelope: "athena",
      responseType: "Record<string, unknown>",
    },
    {
      method: "POST",
      name: "getStorageBucketLifecycle",
      path: "/storage/buckets/lifecycle",
      requestType: "StorageBucketLifecycleRequest",
      responseEnvelope: "athena",
      responseType: "Record<string, unknown>",
    },
    {
      method: "POST",
      name: "setStorageBucketLifecycle",
      path: "/storage/buckets/lifecycle/set",
      requestType: "StorageSetBucketLifecycleRequest",
      responseEnvelope: "athena",
      responseType: "Record<string, unknown>",
    },
    {
      method: "POST",
      name: "deleteStorageBucketLifecycle",
      path: "/storage/buckets/lifecycle/delete",
      requestType: "StorageBucketLifecycleRequest",
      responseEnvelope: "athena",
      responseType: "Record<string, unknown>",
    },
    {
      method: "POST",
      name: "getStorageBucketPolicy",
      path: "/storage/buckets/policy",
      requestType: "StorageBucketPolicyRequest",
      responseEnvelope: "athena",
      responseType: "Record<string, unknown>",
    },
    {
      method: "POST",
      name: "setStorageBucketPolicy",
      path: "/storage/buckets/policy/set",
      requestType: "StorageSetBucketPolicyRequest",
      responseEnvelope: "athena",
      responseType: "Record<string, unknown>",
    },
    {
      method: "POST",
      name: "deleteStorageBucketPolicy",
      path: "/storage/buckets/policy/delete",
      requestType: "StorageBucketPolicyRequest",
      responseEnvelope: "athena",
      responseType: "Record<string, unknown>",
    },
    {
      method: "POST",
      name: "getStorageBucketPublicAccess",
      path: "/storage/buckets/public-access",
      requestType: "StoragePublicAccessBlockRequest",
      responseEnvelope: "athena",
      responseType: "Record<string, unknown>",
    },
    {
      method: "POST",
      name: "setStorageBucketPublicAccess",
      path: "/storage/buckets/public-access/set",
      requestType: "StorageSetPublicAccessBlockRequest",
      responseEnvelope: "athena",
      responseType: "Record<string, unknown>",
    },
    {
      method: "POST",
      name: "deleteStorageBucketPublicAccess",
      path: "/storage/buckets/public-access/delete",
      requestType: "StoragePublicAccessBlockRequest",
      responseEnvelope: "athena",
      responseType: "Record<string, unknown>",
    },
    {
      method: "POST",
      name: "getStorageBucketCors",
      path: "/storage/buckets/cors",
      requestType: "StorageBucketCorsRequest",
      responseEnvelope: "athena",
      responseType: "Record<string, unknown>",
    },
    {
      method: "POST",
      name: "setStorageBucketCors",
      path: "/storage/buckets/cors/set",
      requestType: "StorageSetBucketCorsRequest",
      responseEnvelope: "athena",
      responseType: "Record<string, unknown>",
    },
    {
      method: "POST",
      name: "deleteStorageBucketCors",
      path: "/storage/buckets/cors/delete",
      requestType: "StorageBucketCorsRequest",
      responseEnvelope: "athena",
      responseType: "Record<string, unknown>",
    },
    {
      method: "POST",
      name: "createStorageMultipartUpload",
      path: "/storage/multipart/create",
      requestType: "StorageMultipartCreateRequest",
      responseEnvelope: "athena",
      responseType: "Record<string, unknown>",
    },
    {
      method: "POST",
      name: "signStorageMultipartPart",
      path: "/storage/multipart/sign-part",
      requestType: "StorageMultipartSignPartRequest",
      responseEnvelope: "athena",
      responseType: "Record<string, unknown>",
    },
    {
      method: "POST",
      name: "completeStorageMultipartUpload",
      path: "/storage/multipart/complete",
      requestType: "StorageMultipartCompleteRequest",
      responseEnvelope: "athena",
      responseType: "StorageFileMutationResponse",
    },
    {
      method: "POST",
      name: "abortStorageMultipartUpload",
      path: "/storage/multipart/abort",
      requestType: "StorageMultipartAbortRequest",
      responseEnvelope: "athena",
      responseType: "Record<string, unknown>",
    },
    {
      method: "POST",
      name: "listStorageMultipartParts",
      path: "/storage/multipart/list-parts",
      requestType: "StorageMultipartListPartsRequest",
      responseEnvelope: "athena",
      responseType: "Record<string, unknown>",
    },
    {
      method: "POST",
      name: "listStorageAuditEvents",
      path: "/storage/audit/list",
      requestType: "StorageAuditQueryRequest",
      responseEnvelope: "athena",
      responseType: "StorageAuditListResponse",
    },
  ],
  namespace: "storage",
} as const;

// Bind route names for AthenaStorageError normalized `operation` labels.
bindStorageErrorRoutes(storageSdkManifest.methods);

export type StorageSdkManifestMethod =
  (typeof storageSdkManifest.methods)[number];
export type StorageSdkManifestMethodName = StorageSdkManifestMethod["name"];

/** Resolve one storageSdkManifest entry by stable method name (throws if missing). */
export function requireStorageManifestRoute(
  name: StorageSdkManifestMethodName
): StorageSdkManifestMethod {
  const route = storageSdkManifest.methods.find(
    (candidate) => candidate.name === name
  );
  if (!route) {
    throw new Error(`Unknown storageSdkManifest route: ${name}`);
  }
  return route;
}

/** Forward-compatible canonical provider identifier. */
export type StorageProviderId =
  | "aws_s3"
  | "cloudflare_r2"
  | "minio"
  | "wasabi"
  | "backblaze_b2"
  | "digitalocean_spaces"
  | "custom_s3"
  | (string & {});

export type StorageImplementationStatus =
  | "implemented"
  | "stable"
  | "beta"
  | "experimental"
  | (string & {});

export interface StorageProviderConnectionField {
  allowedValues?: string[];
  defaultValue?: unknown;
  description: string;
  key: string;
  required: boolean;
  secret: boolean;
  valueType: string;
}

/** Public provider metadata normalized from Athena's provider descriptor. */
export interface StorageProviderDescriptor {
  connectionSchema: { fields: StorageProviderConnectionField[] };
  defaultEndpointTemplate?: string;
  defaultRegion: string;
  forcePathStyleDefault: boolean;
  id: StorageProviderId;
  implementationStatus: StorageImplementationStatus;
  integration?: Record<string, unknown>;
  protocol: "s3_compatible" | (string & {});
}

export interface PublicStorageConnectionConfig {
  bucket: string;
  defaultPrefix?: string;
  endpoint: string;
  forcePathStyle: boolean;
  metadata: Record<string, unknown>;
  publicBaseUrl?: string;
  region: string;
}

export interface StorageConnectionCredentialState {
  activeCredentialId?: string;
  configured: boolean;
}

/** Secret-safe connection representation returned by canonical HTTP routes. */
export interface StorageConnection {
  config: PublicStorageConnectionConfig;
  createdAt?: string;
  credentialState: StorageConnectionCredentialState;
  description?: string;
  id: string;
  isActive: boolean;
  name: string;
  protocol: string;
  providerId: StorageProviderId;
  updatedAt?: string;
  vendor?: string;
}

interface StorageConnectionConfigInput {
  bucket: string;
  defaultPrefix?: string;
  endpoint?: string;
  forcePathStyle?: boolean;
  metadata?: Record<string, unknown>;
  publicBaseUrl?: string;
  region?: string;
}

interface StorageConnectionCredentialsInput {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

export interface CreateAwsS3ConnectionInput {
  config: StorageConnectionConfigInput & { region: string };
  credentials: StorageConnectionCredentialsInput;
  description?: string;
  name: string;
  provider: "aws_s3";
}

export interface CreateCloudflareR2ConnectionInput {
  config: StorageConnectionConfigInput & { accountId?: string };
  credentials: StorageConnectionCredentialsInput;
  description?: string;
  name: string;
  provider: "cloudflare_r2";
}

export interface CreateMinioConnectionInput {
  config: StorageConnectionConfigInput & { endpoint: string; region: string };
  credentials: StorageConnectionCredentialsInput;
  description?: string;
  name: string;
  provider: "minio";
}

export interface CreateCustomS3ConnectionInput {
  config: StorageConnectionConfigInput & { endpoint: string; region: string };
  credentials: StorageConnectionCredentialsInput;
  description?: string;
  name: string;
  provider: "custom_s3" | (string & {});
}

export type CreateStorageConnectionInput =
  | CreateAwsS3ConnectionInput
  | CreateCloudflareR2ConnectionInput
  | CreateMinioConnectionInput
  | CreateCustomS3ConnectionInput;

export type TestStorageConnectionInput = CreateStorageConnectionInput;

export type FileVisibility = "private" | "organization" | "public";
export type ManagedFileStatus =
  | "requested"
  | "pending"
  | "uploading"
  | "presigned"
  | "available"
  | "failed"
  | "abandoned"
  | "soft_deleted"
  | "purged"
  | (string & {});

/** Public managed-file representation from canonical service routes. */
export interface ManagedFile {
  bucket: string;
  checksumSha256?: string;
  connectionId?: string;
  contentType?: string;
  createdAt?: string;
  createdByUserId?: string;
  deletedAt?: string;
  id: string;
  key: string;
  metadata: Record<string, unknown>;
  name: string;
  organizationId?: string;
  sizeBytes?: number;
  status: ManagedFileStatus;
  updatedAt?: string;
  visibility: FileVisibility;
}

export interface UploadManagedFileInput {
  body: Uint8Array;
  bucket: string;
  connectionId: string;
  contentType?: string;
  idempotencyKey?: string;
  key: string;
  organizationId?: string;
}

export interface ListManagedFilesInput {
  connectionId: string;
  organizationId?: string;
  prefix?: string;
}

export interface MoveManagedFileInput {
  destinationKey: string;
}

export interface SetManagedFileVisibilityInput {
  visibility: FileVisibility;
}

export type FilePermissionAction =
  | "read"
  | "write"
  | "delete"
  | "share"
  | "owner";

export interface FilePermission {
  action: FilePermissionAction;
  expiresAt?: string;
  fileId: string;
  grantedByUserId?: string;
  id: string;
  metadata: Record<string, unknown>;
  principalId: string;
  principalType: string;
  revokedAt?: string;
}

export interface GrantFilePermissionInput {
  action: FilePermissionAction;
  principalId: string;
  principalType: string;
}

export type RevokeFilePermissionInput = GrantFilePermissionInput;

export interface S3CatalogItem {
  bucket: string;
  created_at: string;
  default_prefix?: string | null;
  endpoint?: string | null;
  force_path_style: boolean;
  id: string;
  is_active: boolean;
  metadata: Record<string, unknown>;
  name: string;
  provider: string;
  public_base_url?: string | null;
  region?: string | null;
  updated_at: string;
}

export interface S3CredentialListItem {
  access_key: string;
  bucket: string;
  created_at: string;
  endpoint?: string | null;
  id: string;
  is_active: boolean;
  name: string;
  provider: string;
  region?: string | null;
  rotated_at?: string | null;
  s3_id: string;
}

export interface ManagedFileRecord {
  bucket: string;
  checksum_sha256?: string | null;
  content_type?: string | null;
  created_at: string;
  created_by_user_id?: string | null;
  deleted_at?: string | null;
  extension?: string | null;
  file_name?: string | null;
  id: string;
  is_public: boolean;
  metadata: Record<string, unknown>;
  mime_type?: string | null;
  name: string;
  organization_id?: string | null;
  original_name?: string | null;
  prefix_path?: string | null;
  resource_id?: string | null;
  s3_id?: string | null;
  size_bytes?: number | null;
  status: string;
  storage_key: string;
  updated_at: string;
  uploaded_by_user_id?: string | null;
  url?: string | null;
  visibility?: "private" | "organization" | "public";
}

export interface PresignedFileUrlResponse {
  bucket: string;
  cache_hit: boolean;
  cache_layer: string;
  expires_at: string;
  expires_at_epoch_seconds: number;
  expires_in: number;
  file_id: string;
  headers?: Record<string, string>;
  purpose: string;
  storage_key: string;
  url: string;
}

export interface StorageServerSideEncryptionOptions {
  bucket_key_enabled?: boolean;
  kms_key_id?: string;
  server_side_encryption?:
    | "AES256"
    | "aws:kms"
    | "aws:kms:dsse"
    | (string & {});
  sse?: "AES256" | "aws:kms" | "aws:kms:dsse" | (string & {});
  ssekms_key_id?: string;
}

export interface CreateStorageCatalogRequest {
  access_key_id: string;
  /**
   * Cloudflare account ID for R2 catalogs when endpoint is omitted.
   * Also accepted under `metadata.account_id`.
   */
  account_id?: string;
  bucket: string;
  default_prefix?: string;
  /**
   * S3-compatible API endpoint.
   * Optional when `provider` is R2 and `account_id` (or `metadata.account_id`) is set;
   * the Athena server derives `https://{account_id}.r2.cloudflarestorage.com`.
   */
  endpoint?: string;
  force_path_style?: boolean;
  metadata?: Record<string, unknown>;
  name: string;
  /** Storage provider: `s3` or `r2`; aliases include `aws`, `aws_s3`, `cloudflare_r2`, and `cloudflare-r2`. */
  provider?: string;
  public_base_url?: string;
  /**
   * Region. Optional for R2 (server defaults to `auto` after normalize).
   */
  region?: string;
  secret_key: string;
  session_token?: string;
}

export interface UpdateStorageCatalogRequest {
  access_key_id?: string;
  /** Cloudflare account ID for R2 (merged into metadata / endpoint derivation). */
  account_id?: string;
  bucket?: string;
  default_prefix?: string | null;
  endpoint?: string;
  force_path_style?: boolean;
  is_active?: boolean;
  metadata?: Record<string, unknown>;
  name?: string;
  provider?: string;
  public_base_url?: string | null;
  region?: string;
  secret_key?: string;
  session_token?: string;
}

export interface CreateStorageUploadUrlRequest
  extends StorageServerSideEncryptionOptions {
  bucket?: string;
  content_type?: string;
  file_id?: string;
  metadata?: Record<string, unknown>;
  mime_type?: string;
  name?: string;
  original_name?: string;
  public?: boolean;
  resource_id?: string;
  s3_id: string;
  size_bytes?: number;
  storage_key: string;
  visibility?: "private" | "organization" | "public";
}

export interface CreateStorageUploadUrlsRequest {
  files: CreateStorageUploadUrlRequest[];
}

export interface StorageUploadUrlResponse {
  file: ManagedFileRecord;
  upload: PresignedFileUrlResponse;
}

export interface StorageBatchUploadUrlResponse {
  files: StorageUploadUrlResponse[];
}

export interface ListStorageFilesRequest {
  bucket?: string;
  content_type?: string;
  key_prefix?: string;
  limit?: number;
  metadata?: Record<string, unknown>;
  mime_type?: string;
  name?: string;
  offset?: number;
  prefix?: string;
  resource_id?: string;
  s3_id: string;
  status?: string;
  visibility?: "private" | "organization" | "public" | (string & {});
}

export interface StorageListFilesResponse {
  count: number;
  files: ManagedFileRecord[];
  has_more?: boolean;
  limit?: number;
  next_offset?: number | null;
  offset?: number;
  total?: number;
}

export interface UpdateStorageFileRequest {
  bucket?: string;
  checksum_sha256?: string;
  content_type?: string;
  file_name?: string;
  metadata?: Record<string, unknown>;
  mime_type?: string;
  name?: string;
  original_name?: string;
  resource_id?: string;
  size_bytes?: number;
  status?: string;
  storage_key?: string;
  visibility?: "private" | "organization" | "public" | (string & {});
}

export interface SetStorageFileVisibilityRequest {
  public?: boolean;
  visibility?: "private" | "organization" | "public";
}

export interface DeleteStorageFolderRequest {
  prefix: string;
  s3_id: string;
}

export interface MoveStorageFolderRequest {
  from_prefix: string;
  s3_id: string;
  to_prefix: string;
}

export interface StorageFileMutationResponse {
  file: ManagedFileRecord;
}

export interface StorageFolderMutationResponse {
  prefix: string;
  processed_files: number;
  s3_id: string;
}

export interface StorageFileMutationManyResponse {
  count: number;
  files: ManagedFileRecord[];
}

export interface StorageFilePermissionRecord {
  created_at: string;
  expires_at?: string | null;
  file_id: string;
  granted_by_user_id?: string | null;
  id: string;
  metadata: Record<string, unknown>;
  permission: "read" | "write" | "delete" | "share" | "owner";
  principal_id: string;
  principal_type: "user" | "organization" | "team" | "role";
  revoked_at?: string | null;
}

export interface StoragePermissionListResponse {
  count: number;
  permissions: StorageFilePermissionRecord[];
}

export interface StoragePermissionCheckResponse {
  allowed: boolean;
  permission: string;
}

export interface StorageAuditEventRecord {
  actor_user_id?: string | null;
  bucket?: string | null;
  created_at: string;
  error?: string | null;
  file_id?: string | null;
  id: string;
  metadata: Record<string, unknown>;
  operation: string;
  organization_id?: string | null;
  s3_id?: string | null;
  status: "success" | "error";
  storage_key?: string | null;
}

export interface StorageAuditListResponse {
  count: number;
  events: StorageAuditEventRecord[];
}

export interface ConfirmStorageUploadRequest {
  checksum_sha256?: string;
  content_type?: string;
  metadata?: Record<string, unknown>;
  size_bytes?: number;
}

export interface SearchStorageFilesRequest {
  bucket?: string;
  content_type?: string;
  key_prefix?: string;
  limit?: number;
  metadata?: Record<string, unknown>;
  mime_type?: string;
  name?: string;
  offset?: number;
  prefix?: string;
  query?: string;
  resource_id?: string;
  s3_id?: string;
  status?: string;
  visibility?: "private" | "organization" | "public" | (string & {});
}

export interface DeleteManyStorageFilesRequest {
  file_ids: string[];
}

export interface UpdateManyStorageFilesRequest {
  bucket?: string;
  checksum_sha256?: string;
  content_type?: string;
  file_ids: string[];
  file_name?: string;
  metadata?: Record<string, unknown>;
  mime_type?: string;
  name?: string;
  original_name?: string;
  resource_id?: string;
  size_bytes?: number;
  status?: string;
  storage_key?: string;
  visibility?: "private" | "organization" | "public" | (string & {});
}

export interface SetManyStorageFileVisibilityRequest {
  file_ids: string[];
  public?: boolean;
  visibility?: "private" | "organization" | "public";
}

export interface CopyStorageFileRequest
  extends StorageServerSideEncryptionOptions {
  bucket?: string;
  file_name?: string;
  metadata?: Record<string, unknown>;
  storage_key: string;
  visibility?: "private" | "organization" | "public";
}

export interface ListStorageFoldersRequest {
  prefix: string;
  s3_id: string;
}

export interface TreeStorageFoldersRequest {
  prefix: string;
  s3_id: string;
}

export interface StoragePermissionListRequest {
  file_id: string;
}

export interface StoragePermissionGrantRequest {
  expires_at?: string;
  file_id: string;
  metadata?: Record<string, unknown>;
  permission: "read" | "write" | "delete" | "share" | "owner";
  principal_id: string;
  principal_type: "user" | "organization" | "team" | "role";
}

export interface StoragePermissionRevokeRequest {
  file_id: string;
  permission: "read" | "write" | "delete" | "share" | "owner";
  principal_id: string;
  principal_type: "user" | "organization" | "team" | "role";
}

export interface StoragePermissionCheckRequest {
  file_id: string;
  permission: "read" | "write" | "delete" | "share" | "owner";
}

export interface StorageMultipartCreateRequest
  extends StorageServerSideEncryptionOptions {
  content_type?: string;
  file_id: string;
}

export interface StorageMultipartSignPartRequest {
  file_id: string;
  part_number: number;
  upload_id: string;
}

export interface StorageMultipartCompletePartInput {
  etag: string;
  part_number: number;
}

export interface StorageMultipartCompleteRequest {
  file_id: string;
  parts: StorageMultipartCompletePartInput[];
  upload_id: string;
}

export interface StorageMultipartAbortRequest {
  file_id: string;
  upload_id: string;
}

export interface StorageMultipartListPartsRequest {
  file_id: string;
  upload_id: string;
}

export interface DeprecatedInlineStorageConnectionFields {
  /**
   * @deprecated Prefer `s3_id` / `s3Id` and a managed storage catalog.
   */
  access_key_id?: string;
  /**
   * @deprecated Prefer `s3_id` / `s3Id` and a managed storage catalog.
   */
  endpoint?: string;
  provider?: string;
  /**
   * @deprecated Prefer `s3_id` / `s3Id` and a managed storage catalog.
   */
  region?: string;
  /**
   * @deprecated Prefer `s3_id` / `s3Id` and a managed storage catalog.
   */
  secret_key?: string;
  /**
   * @deprecated Prefer `s3_id` / `s3Id` and a managed storage catalog.
   */
  session_token?: string;
}

export type StorageConnectionSelector =
  | ({
      s3_id: string;
      s3Id?: string;
    } & DeprecatedInlineStorageConnectionFields)
  | ({
      s3_id?: string;
      s3Id: string;
    } & DeprecatedInlineStorageConnectionFields)
  | ({
      s3_id?: string;
      s3Id?: string;
      endpoint: string;
      region: string;
      access_key_id: string;
      secret_key: string;
    } & DeprecatedInlineStorageConnectionFields);

export type StorageObjectFolderCreateRequest = StorageConnectionSelector & {
  bucket: string;
  prefix: string;
};

export type StorageObjectFolderDeleteRequest = StorageObjectFolderCreateRequest;

export interface StorageObjectFolderRenameRequest
  extends Omit<StorageObjectFolderCreateRequest, "prefix"> {
  from_prefix: string;
  to_prefix: string;
}

export type StorageObjectBaseRequest = StorageConnectionSelector & {
  bucket: string;
};

export type StorageObjectRequest = StorageObjectBaseRequest & {
  key: string;
};

export type StorageObjectValidateRequest = StorageObjectRequest & {
  checksum_sha256?: string;
  etag?: string;
};

export type StorageObjectCopyRequest = StorageObjectBaseRequest &
  StorageServerSideEncryptionOptions & {
    source_key: string;
    destination_key: string;
    destination_bucket?: string;
  };

export type StorageObjectPublicUrlRequest = StorageObjectRequest & {
  public_base_url?: string;
  force_path_style?: boolean;
};

export type StorageListObjectsRequest = StorageObjectBaseRequest & {
  prefix?: string;
  delimiter?: string;
  continuation_token?: string;
  max_keys?: number;
};

export type StorageUpdateObjectRequest = StorageObjectRequest & {
  acl?: string;
  content_type?: string;
  cache_control?: string;
  content_disposition?: string;
  content_encoding?: string;
  content_language?: string;
  metadata?: Record<string, string>;
};

export type StorageObjectVersionListRequest = StorageObjectBaseRequest & {
  key?: string;
  max_keys?: number;
  key_marker?: string;
  version_id_marker?: string;
  delimiter?: string;
};

export type StorageObjectVersionMutationRequest = StorageObjectRequest & {
  version_id: string;
};

export type StorageSignedPostPolicyRequest = StorageObjectRequest &
  StorageServerSideEncryptionOptions & {
    content_type?: string;
    min_size?: number;
    max_size?: number;
    expires_in?: number;
    public_base_url?: string;
    force_path_style?: boolean;
    success_action_status?: string;
  };

export type StoragePresignUploadRequest = StorageObjectRequest &
  StorageServerSideEncryptionOptions & {
    content_type?: string;
  };

export type StorageBucketCorsRequest = StorageObjectBaseRequest;

export interface StorageBucketCorsRuleInput {
  allowed_headers?: string[];
  allowed_methods: string[];
  allowed_origins: string[];
  expose_headers?: string[];
  max_age_seconds?: number;
}

export type StorageSetBucketCorsRequest = StorageBucketCorsRequest & {
  rules: StorageBucketCorsRuleInput[];
};

export type StorageBucketLifecycleRequest = StorageObjectBaseRequest;

export interface StorageBucketLifecycleRuleInput {
  abort_incomplete_multipart_upload_days?: number;
  expiration_days?: number;
  expired_object_delete_marker?: boolean;
  id?: string;
  noncurrent_version_expiration_days?: number;
  prefix?: string;
  status?: "Enabled" | "Disabled" | "enabled" | "disabled" | (string & {});
}

export type StorageSetBucketLifecycleRequest = StorageBucketLifecycleRequest & {
  rules: StorageBucketLifecycleRuleInput[];
};

export type StorageBucketPolicyRequest = StorageObjectBaseRequest;

export type StorageSetBucketPolicyRequest = StorageBucketPolicyRequest & {
  policy: Record<string, unknown> | string;
};

export type StoragePublicAccessBlockRequest = StorageObjectBaseRequest;

export type StorageSetPublicAccessBlockRequest =
  StoragePublicAccessBlockRequest & {
    block_public_acls?: boolean;
    ignore_public_acls?: boolean;
    block_public_policy?: boolean;
    restrict_public_buckets?: boolean;
  };

export interface StorageFileVersionPathRequest {
  file_id: string;
  version_id: string;
}

export interface StorageFileRetentionRequest {
  bypass_governance?: boolean;
  mode?: "GOVERNANCE" | "COMPLIANCE" | (string & {});
  retain_until?: string;
  retain_until_date?: string;
  version_id?: string;
}

export interface StorageAuditQueryRequest {
  file_id?: string;
  limit?: number;
  offset?: number;
}

export interface AthenaEnvelope<T> {
  data: T;
  message: string;
  status: string;
}

export type StorageFileAccessPurpose = "read" | "download" | "stream";

export interface GetStorageFileUrlQuery {
  purpose?: StorageFileAccessPurpose | (string & {});
}

export interface AthenaStorageClientConfig extends AthenaStorageFileConfig {
  onError?: AthenaStorageErrorHandler;
}

/**
 * Credentials for signing the direct upload PUT in the client.
 * The Athena API still creates managed-file metadata so the public upload
 * result remains unchanged; file bytes go directly to this S3-compatible endpoint.
 */
export interface AthenaStorageDirectUploadConfig {
  accessKeyId: string;
  bucket?: string;
  endpoint: string;
  /** R2 uses path-style addressing by default. */
  forcePathStyle?: boolean;
  region?: string;
  secretAccessKey: string;
  sessionToken?: string;
}

export interface AthenaStorageCallOptions extends AthenaGatewayCallOptions {
  onError?: AthenaStorageErrorHandler;
  signal?: AbortSignal;
}

export type AthenaStorageBinaryCallOptions = AthenaStorageCallOptions;

export interface AthenaCanonicalStorageProvidersNamespace {
  list: (options?: AthenaStorageCallOptions) => Promise<StorageProviderDescriptor[]>;
}

export interface AthenaCanonicalStorageConnectionsNamespace {
  create: (
    input: CreateStorageConnectionInput,
    options?: AthenaStorageCallOptions
  ) => Promise<StorageConnection>;
  delete: (
    id: string,
    options?: AthenaStorageCallOptions
  ) => Promise<{ connectionId: string }>;
  get: (id: string, options?: AthenaStorageCallOptions) => Promise<StorageConnection>;
  list: (options?: AthenaStorageCallOptions) => Promise<StorageConnection[]>;
  test: (
    input: TestStorageConnectionInput,
    options?: AthenaStorageCallOptions
  ) => Promise<{ config: PublicStorageConnectionConfig; ok: boolean }>;
}

export interface AthenaCanonicalStorageFilesNamespace {
  delete: (fileId: string, options?: AthenaStorageCallOptions) => Promise<ManagedFile>;
  get: (fileId: string, options?: AthenaStorageCallOptions) => Promise<ManagedFile>;
  list: (
    input: ListManagedFilesInput,
    options?: AthenaStorageCallOptions
  ) => Promise<ManagedFile[]>;
  move: (
    fileId: string,
    input: MoveManagedFileInput,
    options?: AthenaStorageCallOptions
  ) => Promise<ManagedFile>;
  purge: (
    fileId: string,
    options?: AthenaStorageCallOptions
  ) => Promise<{ fileId: string }>;
  restore: (fileId: string, options?: AthenaStorageCallOptions) => Promise<ManagedFile>;
  setVisibility: (
    fileId: string,
    input: SetManagedFileVisibilityInput,
    options?: AthenaStorageCallOptions
  ) => Promise<ManagedFile>;
  upload: (
    input: UploadManagedFileInput,
    options?: AthenaStorageCallOptions
  ) => Promise<ManagedFile>;
}

export interface AthenaCanonicalStoragePermissionsNamespace {
  grant: (
    fileId: string,
    input: GrantFilePermissionInput,
    options?: AthenaStorageCallOptions
  ) => Promise<FilePermission>;
  list: (
    fileId: string,
    options?: AthenaStorageCallOptions
  ) => Promise<FilePermission[]>;
  revoke: (
    fileId: string,
    input: RevokeFilePermissionInput,
    options?: AthenaStorageCallOptions
  ) => Promise<{ fileId: string }>;
}

export interface AthenaStorageBaseModule {
  createStorageCatalog: (
    input: CreateStorageCatalogRequest,
    options?: AthenaStorageCallOptions
  ) => Promise<S3CatalogItem>;
  createStorageUploadUrl: (
    input: CreateStorageUploadUrlRequest,
    options?: AthenaStorageCallOptions
  ) => Promise<StorageUploadUrlResponse>;
  createStorageUploadUrls: (
    input: CreateStorageUploadUrlsRequest,
    options?: AthenaStorageCallOptions
  ) => Promise<StorageBatchUploadUrlResponse>;
  deleteStorageCatalog: (
    id: string,
    options?: AthenaStorageCallOptions
  ) => Promise<{ id: string; deleted: boolean }>;
  deleteStorageFile: (
    fileId: string,
    options?: AthenaStorageCallOptions
  ) => Promise<StorageFileMutationResponse>;
  deleteStorageFolder: (
    input: DeleteStorageFolderRequest,
    options?: AthenaStorageCallOptions
  ) => Promise<StorageFolderMutationResponse>;
  getStorageFile: (
    fileId: string,
    options?: AthenaStorageCallOptions
  ) => Promise<StorageFileMutationResponse>;
  getStorageFileProxy: (
    fileId: string,
    query?: GetStorageFileUrlQuery,
    options?: AthenaStorageBinaryCallOptions
  ) => Promise<Response>;
  getStorageFileUrl: (
    fileId: string,
    query?: GetStorageFileUrlQuery,
    options?: AthenaStorageCallOptions
  ) => Promise<PresignedFileUrlResponse>;
  listStorageCatalogs: (
    options?: AthenaStorageCallOptions
  ) => Promise<{ data: S3CatalogItem[] }>;
  listStorageCredentials: (
    options?: AthenaStorageCallOptions
  ) => Promise<{ data: S3CredentialListItem[] }>;
  listStorageFiles: (
    input: ListStorageFilesRequest,
    options?: AthenaStorageCallOptions
  ) => Promise<StorageListFilesResponse>;
  moveStorageFolder: (
    input: MoveStorageFolderRequest,
    options?: AthenaStorageCallOptions
  ) => Promise<StorageFolderMutationResponse>;
  setStorageFileVisibility: (
    fileId: string,
    input: SetStorageFileVisibilityRequest,
    options?: AthenaStorageCallOptions
  ) => Promise<StorageFileMutationResponse>;
  updateStorageCatalog: (
    id: string,
    input: UpdateStorageCatalogRequest,
    options?: AthenaStorageCallOptions
  ) => Promise<S3CatalogItem>;
  updateStorageFile: (
    fileId: string,
    input: UpdateStorageFileRequest,
    options?: AthenaStorageCallOptions
  ) => Promise<StorageFileMutationResponse>;
}

export type AthenaStoragePutBody =
  | Blob
  | ArrayBuffer
  | Uint8Array
  | ReadableStream<Uint8Array>;

export interface AthenaStoragePutOptions {
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export interface AthenaStorageManagedUpload extends PresignedFileUrlResponse {
  expiresAt: string;
  headers: Record<string, string>;
  method: "PUT";
  put: (
    body: AthenaStoragePutBody,
    options?: AthenaStoragePutOptions
  ) => Promise<Response>;
}

export interface StorageUploadUrlResponseWithPut
  extends Omit<StorageUploadUrlResponse, "upload"> {
  upload: AthenaStorageManagedUpload;
}

export interface StorageBatchUploadUrlResponseWithPut {
  files: StorageUploadUrlResponseWithPut[];
}

export interface AthenaStorageFileUploadRequest
  extends StorageServerSideEncryptionOptions {
  bucket?: string;
  content_type?: string;
  contentType?: string;
  file_id?: string;
  fileId?: string;
  fileName?: string;
  metadata?: Record<string, unknown>;
  mime_type?: string;
  mimeType?: string;
  name?: string;
  original_name?: string;
  originalName?: string;
  public?: boolean;
  resource_id?: string;
  resourceId?: string;
  s3_id?: string;
  s3Id?: string;
  size_bytes?: number;
  sizeBytes?: number;
  storage_key?: string;
  storageKey?: string;
  visibility?: "private" | "organization" | "public";
}

export interface AthenaStorageFileUploadManyRequest {
  files: AthenaStorageFileUploadRequest[];
}

export interface AthenaStorageFileNamespace extends AthenaStorageFileModule {
  confirmUpload: (
    fileId: string,
    input?: ConfirmStorageUploadRequest,
    options?: AthenaStorageCallOptions
  ) => Promise<StorageFileMutationResponse>;
  copy: (
    fileId: string,
    input: CopyStorageFileRequest,
    options?: AthenaStorageCallOptions
  ) => Promise<StorageFileMutationResponse>;
  deleteMany: (
    input: DeleteManyStorageFilesRequest,
    options?: AthenaStorageCallOptions
  ) => Promise<StorageFileMutationManyResponse>;
  deleteVersion: (
    fileId: string,
    versionId: string,
    options?: AthenaStorageCallOptions
  ) => Promise<Record<string, unknown>>;
  get: (
    fileId: string,
    options?: AthenaStorageCallOptions
  ) => Promise<StorageFileMutationResponse>;
  proxy: (
    fileId: string,
    query?: GetStorageFileUrlQuery,
    options?: AthenaStorageBinaryCallOptions
  ) => Promise<Response>;
  proxyUrl: (
    fileId: string,
    query?: GetStorageFileUrlQuery,
    options?: AthenaStorageCallOptions
  ) => Promise<Record<string, unknown>>;
  publicUrl: (
    fileId: string,
    options?: AthenaStorageCallOptions
  ) => Promise<Record<string, unknown>>;
  purge: (
    fileId: string,
    options?: AthenaStorageCallOptions
  ) => Promise<StorageFileMutationResponse>;
  restore: (
    fileId: string,
    options?: AthenaStorageCallOptions
  ) => Promise<StorageFileMutationResponse>;
  restoreVersion: (
    fileId: string,
    versionId: string,
    options?: AthenaStorageCallOptions
  ) => Promise<Record<string, unknown>>;
  retention: {
    get: (
      fileId: string,
      query?: Pick<StorageFileRetentionRequest, "version_id">,
      options?: AthenaStorageCallOptions
    ) => Promise<Record<string, unknown>>;
    set: (
      fileId: string,
      input: StorageFileRetentionRequest,
      options?: AthenaStorageCallOptions
    ) => Promise<Record<string, unknown>>;
  };
  search: (
    input: SearchStorageFilesRequest,
    options?: AthenaStorageCallOptions
  ) => Promise<StorageListFilesResponse>;
  update: (
    fileId: string,
    input: UpdateStorageFileRequest,
    options?: AthenaStorageCallOptions
  ) => Promise<StorageFileMutationResponse>;
  updateMany: (
    input: UpdateManyStorageFilesRequest,
    options?: AthenaStorageCallOptions
  ) => Promise<StorageFileMutationManyResponse>;
  upload(
    input: AthenaStorageFileUploadRequest,
    options?: AthenaStorageCallOptions
  ): Promise<StorageUploadUrlResponseWithPut>;
  upload(
    input: Parameters<AthenaStorageFileModule["upload"]>[0],
    options?: AthenaStorageCallOptions
  ): ReturnType<AthenaStorageFileModule["upload"]>;
  uploadBinary: (
    fileId: string,
    body: AthenaStoragePutBody,
    options?: AthenaStorageCallOptions
  ) => Promise<StorageFileMutationResponse>;
  uploadMany: (
    input: AthenaStorageFileUploadManyRequest,
    options?: AthenaStorageCallOptions
  ) => Promise<StorageBatchUploadUrlResponseWithPut>;
  url: (
    fileId: string,
    query?: GetStorageFileUrlQuery,
    options?: AthenaStorageCallOptions
  ) => Promise<PresignedFileUrlResponse>;
  versions: (
    fileId: string,
    options?: AthenaStorageCallOptions
  ) => Promise<Record<string, unknown>>;
  visibility: {
    update: (
      fileId: string,
      input: SetStorageFileVisibilityRequest,
      options?: AthenaStorageCallOptions
    ) => Promise<StorageFileMutationResponse>;
    set: (
      fileId: string,
      input: SetStorageFileVisibilityRequest,
      options?: AthenaStorageCallOptions
    ) => Promise<StorageFileMutationResponse>;
    setMany: (
      input: SetManyStorageFileVisibilityRequest,
      options?: AthenaStorageCallOptions
    ) => Promise<StorageFileMutationManyResponse>;
  };
}

export interface AthenaStorageCredentialsNamespace {
  list: (
    options?: AthenaStorageCallOptions
  ) => Promise<{ data: S3CredentialListItem[] }>;
}

export interface AthenaStorageCatalogNamespace {
  create: (
    input: CreateStorageCatalogRequest,
    options?: AthenaStorageCallOptions
  ) => Promise<S3CatalogItem>;
  delete: (
    id: string,
    options?: AthenaStorageCallOptions
  ) => Promise<{ id: string; deleted: boolean }>;
  list: (
    options?: AthenaStorageCallOptions
  ) => Promise<{ data: S3CatalogItem[] }>;
  update: (
    id: string,
    input: UpdateStorageCatalogRequest,
    options?: AthenaStorageCallOptions
  ) => Promise<S3CatalogItem>;
}

export interface AthenaStorageFolderNamespace {
  delete: (
    input: DeleteStorageFolderRequest,
    options?: AthenaStorageCallOptions
  ) => Promise<StorageFolderMutationResponse>;
  list: (
    input: ListStorageFoldersRequest,
    options?: AthenaStorageCallOptions
  ) => Promise<Record<string, unknown>>;
  move: (
    input: MoveStorageFolderRequest,
    options?: AthenaStorageCallOptions
  ) => Promise<StorageFolderMutationResponse>;
  tree: (
    input: TreeStorageFoldersRequest,
    options?: AthenaStorageCallOptions
  ) => Promise<Record<string, unknown>>;
}

export interface AthenaStoragePermissionNamespace {
  check: (
    input: StoragePermissionCheckRequest,
    options?: AthenaStorageCallOptions
  ) => Promise<StoragePermissionCheckResponse>;
  grant: (
    input: StoragePermissionGrantRequest,
    options?: AthenaStorageCallOptions
  ) => Promise<Record<string, unknown>>;
  list: (
    input: StoragePermissionListRequest,
    options?: AthenaStorageCallOptions
  ) => Promise<StoragePermissionListResponse>;
  revoke: (
    input: StoragePermissionRevokeRequest,
    options?: AthenaStorageCallOptions
  ) => Promise<Record<string, unknown>>;
}

export interface AthenaStorageObjectFolderNamespace {
  create: (
    input: StorageObjectFolderCreateRequest,
    options?: AthenaStorageCallOptions
  ) => Promise<Record<string, unknown>>;
  delete: (
    input: StorageObjectFolderDeleteRequest,
    options?: AthenaStorageCallOptions
  ) => Promise<Record<string, unknown>>;
  rename: (
    input: StorageObjectFolderRenameRequest,
    options?: AthenaStorageCallOptions
  ) => Promise<Record<string, unknown>>;
}

export interface AthenaStorageObjectNamespace {
  copy: (
    input: StorageObjectCopyRequest,
    options?: AthenaStorageCallOptions
  ) => Promise<Record<string, unknown>>;
  delete: (
    input: StorageObjectRequest,
    options?: AthenaStorageCallOptions
  ) => Promise<Record<string, unknown>>;
  deleteVersion: (
    input: StorageObjectVersionMutationRequest,
    options?: AthenaStorageCallOptions
  ) => Promise<Record<string, unknown>>;
  exists: (
    input: StorageObjectRequest,
    options?: AthenaStorageCallOptions
  ) => Promise<Record<string, unknown>>;
  folder: AthenaStorageObjectFolderNamespace;
  head: (
    input: StorageObjectRequest,
    options?: AthenaStorageCallOptions
  ) => Promise<Record<string, unknown>>;
  list: (
    input: StorageListObjectsRequest,
    options?: AthenaStorageCallOptions
  ) => Promise<Record<string, unknown>>;
  postPolicy: (
    input: StorageSignedPostPolicyRequest,
    options?: AthenaStorageCallOptions
  ) => Promise<Record<string, unknown>>;
  publicUrl: (
    input: StorageObjectPublicUrlRequest,
    options?: AthenaStorageCallOptions
  ) => Promise<Record<string, unknown>>;
  restoreVersion: (
    input: StorageObjectVersionMutationRequest,
    options?: AthenaStorageCallOptions
  ) => Promise<Record<string, unknown>>;
  update: (
    input: StorageUpdateObjectRequest,
    options?: AthenaStorageCallOptions
  ) => Promise<Record<string, unknown>>;
  uploadUrl: (
    input: StoragePresignUploadRequest,
    options?: AthenaStorageCallOptions
  ) => Promise<Record<string, unknown>>;
  url: (
    input: StorageObjectRequest,
    options?: AthenaStorageCallOptions
  ) => Promise<Record<string, unknown>>;
  validate: (
    input: StorageObjectValidateRequest,
    options?: AthenaStorageCallOptions
  ) => Promise<Record<string, unknown>>;
  versions: (
    input: StorageObjectVersionListRequest,
    options?: AthenaStorageCallOptions
  ) => Promise<Record<string, unknown>>;
}

export interface AthenaStorageBucketCorsNamespace {
  delete: (
    input: StorageBucketCorsRequest,
    options?: AthenaStorageCallOptions
  ) => Promise<Record<string, unknown>>;
  get: (
    input: StorageBucketCorsRequest,
    options?: AthenaStorageCallOptions
  ) => Promise<Record<string, unknown>>;
  set: (
    input: StorageSetBucketCorsRequest,
    options?: AthenaStorageCallOptions
  ) => Promise<Record<string, unknown>>;
}

export interface AthenaStorageBucketNamespace {
  cors: AthenaStorageBucketCorsNamespace;
  create: (
    input: StorageObjectBaseRequest,
    options?: AthenaStorageCallOptions
  ) => Promise<Record<string, unknown>>;
  delete: (
    input: StorageObjectBaseRequest,
    options?: AthenaStorageCallOptions
  ) => Promise<Record<string, unknown>>;
  lifecycle: {
    get: (
      input: StorageBucketLifecycleRequest,
      options?: AthenaStorageCallOptions
    ) => Promise<Record<string, unknown>>;
    set: (
      input: StorageSetBucketLifecycleRequest,
      options?: AthenaStorageCallOptions
    ) => Promise<Record<string, unknown>>;
    delete: (
      input: StorageBucketLifecycleRequest,
      options?: AthenaStorageCallOptions
    ) => Promise<Record<string, unknown>>;
  };
  list: (
    input: Omit<StorageObjectBaseRequest, "bucket">,
    options?: AthenaStorageCallOptions
  ) => Promise<Record<string, unknown>>;
  policy: {
    get: (
      input: StorageBucketPolicyRequest,
      options?: AthenaStorageCallOptions
    ) => Promise<Record<string, unknown>>;
    set: (
      input: StorageSetBucketPolicyRequest,
      options?: AthenaStorageCallOptions
    ) => Promise<Record<string, unknown>>;
    delete: (
      input: StorageBucketPolicyRequest,
      options?: AthenaStorageCallOptions
    ) => Promise<Record<string, unknown>>;
  };
  publicAccess: {
    get: (
      input: StoragePublicAccessBlockRequest,
      options?: AthenaStorageCallOptions
    ) => Promise<Record<string, unknown>>;
    set: (
      input: StorageSetPublicAccessBlockRequest,
      options?: AthenaStorageCallOptions
    ) => Promise<Record<string, unknown>>;
    delete: (
      input: StoragePublicAccessBlockRequest,
      options?: AthenaStorageCallOptions
    ) => Promise<Record<string, unknown>>;
  };
}

export interface AthenaStorageMultipartNamespace {
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
  listParts: (
    input: StorageMultipartListPartsRequest,
    options?: AthenaStorageCallOptions
  ) => Promise<Record<string, unknown>>;
  signPart: (
    input: StorageMultipartSignPartRequest,
    options?: AthenaStorageCallOptions
  ) => Promise<Record<string, unknown>>;
}

export interface AthenaStorageAuditNamespace {
  list: (
    input: StorageAuditQueryRequest,
    options?: AthenaStorageCallOptions
  ) => Promise<StorageAuditListResponse>;
}

export interface AthenaStorageModule extends AthenaStorageBaseModule {
  audit: AthenaStorageAuditNamespace;
  /**
   * Database backup / restore admin API (`/admin/backups*`).
   * Archives are stored in the server S3 or R2 profile (`ATHENA_BACKUP_S3_*`).
   */
  backup: AthenaStorageBackupNamespace;
  bucket: AthenaStorageBucketNamespace;
  catalog: AthenaStorageCatalogNamespace;
  /** Canonical service-backed connection API. */
  connections: AthenaCanonicalStorageConnectionsNamespace;
  credentials: AthenaStorageCredentialsNamespace;
  delete: AthenaStorageFileModule["delete"];
  file: AthenaStorageFileNamespace;
  /** Canonical service-backed managed-file API. */
  files: AthenaCanonicalStorageFilesNamespace;
  folder: AthenaStorageFolderNamespace;
  multipart: AthenaStorageMultipartNamespace;
  /** Canonical service-backed managed-file authorization API. */
  permissions: AthenaCanonicalStoragePermissionsNamespace;
  /** Canonical provider capability discovery API. */
  providers: AthenaCanonicalStorageProvidersNamespace;
  object: AthenaStorageObjectNamespace;
  permission: AthenaStoragePermissionNamespace;
}

type StorageEnvelopeKind = "raw" | "athena";

interface StorageModuleRuntimeOptions {
  baseUrl?: string;
  onError?: AthenaStorageErrorHandler;
  stripBasePath?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function headerValue(
  headers: Headers,
  names: readonly string[]
): string | undefined {
  for (const name of names) {
    const value = headers.get(name);
    if (value?.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function storagePath(path: string): AthenaGatewayEndpointPath {
  return path as AthenaGatewayEndpointPath;
}

function resolveStorageEndpointPath(
  endpoint: AthenaGatewayEndpointPath,
  runtimeOptions?: StorageModuleRuntimeOptions
): AthenaGatewayEndpointPath {
  if (!runtimeOptions?.stripBasePath) {
    return endpoint;
  }

  const [pathname, queryText] = String(endpoint).split("?", 2);
  const trimmedPathname = pathname.startsWith("/storage/")
    ? pathname.slice("/storage".length)
    : pathname === "/storage"
      ? "/"
      : pathname;
  const resolvedPath = trimmedPathname.startsWith("/")
    ? trimmedPathname
    : `/${trimmedPathname}`;
  return storagePath(queryText ? `${resolvedPath}?${queryText}` : resolvedPath);
}

function withPathParam(path: string, name: string, value: string): string {
  return path.replace(`{${name}}`, encodeURIComponent(value));
}

function fillManifestPath(
  template: string,
  pathParams?: Record<string, string>
): string {
  if (!pathParams) {
    return template;
  }
  let path = template;
  for (const [key, value] of Object.entries(pathParams)) {
    path = withPathParam(path, key, value);
  }
  return path;
}

function resolveErrorMessage(payload: unknown, fallback: string): string {
  if (isRecord(payload)) {
    const message = payload.message ?? payload.error ?? payload.details;
    if (typeof message === "string" && message.trim()) {
      return message.trim();
    }
  }
  if (typeof payload === "string" && payload.trim()) {
    return payload.trim();
  }
  return fallback;
}

function resolveErrorHint(payload: unknown): string | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }
  const hint = payload.hint ?? payload.suggestion;
  return typeof hint === "string" && hint.trim() ? hint.trim() : undefined;
}

function resolveErrorCause(payload: unknown): string | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }
  const cause = payload.cause ?? payload.reason;
  return typeof cause === "string" && cause.trim() ? cause.trim() : undefined;
}

function storageCodeFromUnknown(error: unknown): AthenaStorageErrorCode {
  if (isAthenaGatewayError(error)) {
    if (error.code === "INVALID_URL") {
      return "INVALID_URL";
    }
    if (error.code === "NETWORK_ERROR") {
      return "NETWORK_ERROR";
    }
    if (error.code === "INVALID_JSON") {
      return "INVALID_JSON";
    }
    if (error.code === "HTTP_ERROR") {
      return "HTTP_ERROR";
    }
  }
  return "UNKNOWN_ERROR";
}

async function callStorageEndpoint<T>(
  gateway: AthenaGatewayClient,
  endpoint: AthenaGatewayEndpointPath,
  method: AthenaGatewayMethod,
  envelope: StorageEnvelopeKind,
  payload?: unknown,
  options?: AthenaStorageCallOptions,
  runtimeOptions?: StorageModuleRuntimeOptions
): Promise<T> {
  const resolvedOptions = await gateway.resolveCallOptions(options);
  let url: string;
  let headers: Record<string, string>;
  try {
    const baseUrl = resolvedOptions?.baseUrl
      ? normalizeAthenaGatewayBaseUrl(resolvedOptions.baseUrl)
      : runtimeOptions?.baseUrl
        ? normalizeAthenaGatewayBaseUrl(runtimeOptions.baseUrl)
        : gateway.baseUrl;
    url = buildAthenaGatewayUrl(
      baseUrl,
      resolveStorageEndpointPath(endpoint, runtimeOptions)
    );
    headers = gateway.buildHeaders(resolvedOptions);
  } catch (error) {
    return rejectStorageError(
      {
        cause: error,
        code: storageCodeFromUnknown(error),
        endpoint,
        hint: isAthenaGatewayError(error) ? error.hint : undefined,
        message:
          error instanceof Error
            ? error.message
            : `Athena storage ${method} ${endpoint} failed before sending the request`,
        method,
        raw: error,
        requestId: isAthenaGatewayError(error) ? error.requestId : undefined,
        status: isAthenaGatewayError(error) ? error.status : 0,
      },
      resolvedOptions,
      runtimeOptions
    );
  }
  const requestInit: RequestInit = {
    headers,
    method,
    signal: resolvedOptions?.signal,
  };
  if (payload !== undefined && method !== "GET") {
    requestInit.body = JSON.stringify(payload);
  }

  let response: Response;
  try {
    response = await fetch(url, requestInit);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return rejectStorageError(
      {
        cause: error,
        code: "NETWORK_ERROR",
        endpoint,
        message: `Network error while calling Athena storage ${method} ${endpoint}: ${message}`,
        method,
        status: 0,
      },
      resolvedOptions,
      runtimeOptions
    );
  }

  let rawText: string;
  try {
    rawText = await response.text();
  } catch (error) {
    return rejectStorageError(
      {
        cause: error,
        code: "NETWORK_ERROR",
        endpoint,
        message: `Athena storage ${method} ${endpoint} response body could not be read`,
        method,
        requestId: headerValue(response.headers, [
          "x-athena-request-id",
          "x-request-id",
          "request-id",
        ]),
        status: response.status,
      },
      resolvedOptions,
      runtimeOptions
    );
  }
  const parsedBody = parseResponseBody(
    rawText ?? "",
    response.headers.get("content-type")
  );
  const requestId = headerValue(response.headers, [
    "x-athena-request-id",
    "x-request-id",
    "request-id",
  ]);
  if (parsedBody.parseFailed) {
    return rejectStorageError(
      {
        code: "INVALID_JSON",
        endpoint,
        message: `Athena storage ${method} ${endpoint} returned malformed JSON`,
        method,
        raw: parsedBody.parsed,
        requestId,
        status: response.status,
      },
      resolvedOptions,
      runtimeOptions
    );
  }

  if (!response.ok) {
    return rejectStorageError(
      {
        cause: resolveErrorCause(parsedBody.parsed),
        code: "HTTP_ERROR",
        endpoint,
        hint: resolveErrorHint(parsedBody.parsed),
        message: resolveErrorMessage(
          parsedBody.parsed,
          `Athena storage ${method} ${endpoint} failed with status ${response.status}`
        ),
        method,
        raw: parsedBody.parsed,
        requestId,
        status: response.status,
      },
      resolvedOptions,
      runtimeOptions
    );
  }

  if (envelope === "athena") {
    if (!(isRecord(parsedBody.parsed) && "data" in parsedBody.parsed)) {
      return rejectStorageError(
        {
          code: "INVALID_ATHENA_ENVELOPE",
          endpoint,
          message: `Athena storage ${method} ${endpoint} returned an invalid Athena envelope`,
          method,
          raw: parsedBody.parsed,
          requestId,
          status: response.status,
        },
        resolvedOptions,
        runtimeOptions
      );
    }
    return parsedBody.parsed.data as T;
  }

  return parsedBody.parsed as T;
}

async function callStorageBinaryEndpoint(
  gateway: AthenaGatewayClient,
  endpoint: AthenaGatewayEndpointPath,
  method: AthenaGatewayMethod,
  options?: AthenaStorageBinaryCallOptions,
  runtimeOptions?: StorageModuleRuntimeOptions
): Promise<Response> {
  const resolvedOptions = await gateway.resolveCallOptions(options);
  let url: string;
  let headers: Record<string, string>;
  try {
    const baseUrl = resolvedOptions?.baseUrl
      ? normalizeAthenaGatewayBaseUrl(resolvedOptions.baseUrl)
      : runtimeOptions?.baseUrl
        ? normalizeAthenaGatewayBaseUrl(runtimeOptions.baseUrl)
        : gateway.baseUrl;
    url = buildAthenaGatewayUrl(
      baseUrl,
      resolveStorageEndpointPath(endpoint, runtimeOptions)
    );
    headers = gateway.buildHeaders(resolvedOptions);
  } catch (error) {
    return rejectStorageError(
      {
        cause: error,
        code: storageCodeFromUnknown(error),
        endpoint,
        hint: isAthenaGatewayError(error) ? error.hint : undefined,
        message:
          error instanceof Error
            ? error.message
            : `Athena storage ${method} ${endpoint} failed before sending the request`,
        method,
        raw: error,
        requestId: isAthenaGatewayError(error) ? error.requestId : undefined,
        status: isAthenaGatewayError(error) ? error.status : 0,
      },
      resolvedOptions,
      runtimeOptions
    );
  }

  let response: Response;
  try {
    response = await fetch(url, {
      headers,
      method,
      signal: resolvedOptions?.signal,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return rejectStorageError(
      {
        cause: error,
        code: "NETWORK_ERROR",
        endpoint,
        message: `Network error while calling Athena storage ${method} ${endpoint}: ${message}`,
        method,
        status: 0,
      },
      resolvedOptions,
      runtimeOptions
    );
  }

  if (response.ok) {
    return response;
  }

  const requestId = headerValue(response.headers, [
    "x-athena-request-id",
    "x-request-id",
    "request-id",
  ]);
  let rawErrorBody: unknown = null;
  try {
    const rawText = await response.text();
    const parsedBody = parseResponseBody(
      rawText ?? "",
      response.headers.get("content-type")
    );
    rawErrorBody = parsedBody.parsed;
  } catch (error) {
    return rejectStorageError(
      {
        cause: error,
        code: "NETWORK_ERROR",
        endpoint,
        message: `Athena storage ${method} ${endpoint} error response body could not be read`,
        method,
        requestId,
        status: response.status,
      },
      resolvedOptions,
      runtimeOptions
    );
  }

  return rejectStorageError(
    {
      cause: resolveErrorCause(rawErrorBody),
      code: "HTTP_ERROR",
      endpoint,
      hint: resolveErrorHint(rawErrorBody),
      message: resolveErrorMessage(
        rawErrorBody,
        `Athena storage ${method} ${endpoint} failed with status ${response.status}`
      ),
      method,
      raw: rawErrorBody,
      requestId,
      status: response.status,
    },
    resolvedOptions,
    runtimeOptions
  );
}

function isBlobBody(body: AthenaStoragePutBody): body is Blob {
  return typeof Blob !== "undefined" && body instanceof Blob;
}

function isReadableStreamBody(
  body: AthenaStoragePutBody
): body is ReadableStream<Uint8Array> {
  return (
    typeof ReadableStream !== "undefined" && body instanceof ReadableStream
  );
}

async function putPresignedUploadBody(
  uploadUrl: string,
  uploadHeaders: Record<string, string>,
  body: AthenaStoragePutBody,
  options?: AthenaStoragePutOptions
): Promise<Response> {
  const headers = new Headers(uploadHeaders);
  for (const [key, value] of Object.entries(options?.headers ?? {})) {
    headers.set(key, value);
  }
  if (!headers.has("Content-Type") && isBlobBody(body) && body.type) {
    headers.set("Content-Type", body.type);
  }

  const init: RequestInit & { duplex?: "half" } = {
    body: body as RequestInit["body"],
    headers,
    method: "PUT",
    signal: options?.signal,
  };
  if (isReadableStreamBody(body)) {
    init.duplex = "half";
  }
  return fetch(uploadUrl, init);
}

function attachManagedUpload(
  upload: PresignedFileUrlResponse
): AthenaStorageManagedUpload {
  const headers: Record<string, string> = { ...(upload.headers ?? {}) };
  return {
    ...upload,
    expiresAt: upload.expires_at,
    headers,
    method: "PUT",
    put(body, options) {
      return putPresignedUploadBody(upload.url, headers, body, options);
    },
  };
}

function attachUploadHelper(
  response: StorageUploadUrlResponse
): StorageUploadUrlResponseWithPut {
  return {
    ...response,
    upload: attachManagedUpload(response.upload),
  };
}

function attachUploadHelpers(
  response: StorageBatchUploadUrlResponse
): StorageBatchUploadUrlResponseWithPut {
  return {
    files: response.files.map(attachUploadHelper),
  };
}

function normalizeUploadUrlRequest(
  input: AthenaStorageFileUploadRequest
): CreateStorageUploadUrlRequest {
  const s3_id = input.s3_id ?? input.s3Id;
  const storage_key = input.storage_key ?? input.storageKey;
  if (!s3_id?.trim()) {
    throw new Error("athena.storage.file.upload requires s3_id or s3Id");
  }
  if (!storage_key?.trim()) {
    throw new Error(
      "athena.storage.file.upload requires storage_key or storageKey"
    );
  }
  const fileName = input.fileName?.trim();
  const originalName = input.originalName?.trim();
  return {
    bucket: input.bucket,
    bucket_key_enabled: input.bucket_key_enabled,
    content_type: input.content_type ?? input.contentType,
    file_id: input.file_id ?? input.fileId,
    kms_key_id: input.kms_key_id,
    metadata: input.metadata,
    mime_type: input.mime_type ?? input.mimeType,
    name: input.name ?? fileName,
    original_name: input.original_name ?? originalName ?? fileName,
    public: input.public,
    resource_id: input.resource_id ?? input.resourceId,
    s3_id,
    server_side_encryption: input.server_side_encryption,
    size_bytes: input.size_bytes ?? input.sizeBytes,
    sse: input.sse,
    ssekms_key_id: input.ssekms_key_id,
    storage_key,
    visibility: input.visibility,
  };
}

async function callStorageUploadBinaryEndpoint<T>(
  gateway: AthenaGatewayClient,
  endpoint: AthenaGatewayEndpointPath,
  body: AthenaStoragePutBody,
  options?: AthenaStorageCallOptions,
  runtimeOptions?: StorageModuleRuntimeOptions
): Promise<T> {
  const resolvedOptions = await gateway.resolveCallOptions(options);
  let url: string;
  let headers: Record<string, string>;
  try {
    const baseUrl = resolvedOptions?.baseUrl
      ? normalizeAthenaGatewayBaseUrl(resolvedOptions.baseUrl)
      : runtimeOptions?.baseUrl
        ? normalizeAthenaGatewayBaseUrl(runtimeOptions.baseUrl)
        : gateway.baseUrl;
    url = buildAthenaGatewayUrl(
      baseUrl,
      resolveStorageEndpointPath(endpoint, runtimeOptions)
    );
    headers = gateway.buildHeaders(resolvedOptions);
  } catch (error) {
    return rejectStorageError(
      {
        cause: error,
        code: storageCodeFromUnknown(error),
        endpoint,
        hint: isAthenaGatewayError(error) ? error.hint : undefined,
        message:
          error instanceof Error
            ? error.message
            : `Athena storage PUT ${endpoint} failed before sending the request`,
        method: "PUT",
        raw: error,
        requestId: isAthenaGatewayError(error) ? error.requestId : undefined,
        status: isAthenaGatewayError(error) ? error.status : 0,
      },
      resolvedOptions,
      runtimeOptions
    );
  }

  // Clear prior content-type so Blob.type / body can own it (delete is intentional).
  // biome-ignore lint/performance/noDelete: must remove keys; undefined assign breaks Headers typing
  delete headers["Content-Type"];
  // biome-ignore lint/performance/noDelete: must remove keys; undefined assign breaks Headers typing
  delete headers["content-type"];
  if (isBlobBody(body) && body.type) {
    headers["Content-Type"] = body.type;
  }

  const requestInit: RequestInit & { duplex?: "half" } = {
    body: body as RequestInit["body"],
    headers,
    method: "PUT",
    signal: resolvedOptions?.signal,
  };
  if (isReadableStreamBody(body)) {
    requestInit.duplex = "half";
  }

  let response: Response;
  try {
    response = await fetch(url, requestInit);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return rejectStorageError(
      {
        cause: error,
        code: "NETWORK_ERROR",
        endpoint,
        message: `Network error while calling Athena storage PUT ${endpoint}: ${message}`,
        method: "PUT",
        status: 0,
      },
      resolvedOptions,
      runtimeOptions
    );
  }

  let rawText: string;
  try {
    rawText = await response.text();
  } catch (error) {
    return rejectStorageError(
      {
        cause: error,
        code: "NETWORK_ERROR",
        endpoint,
        message: `Athena storage PUT ${endpoint} response body could not be read`,
        method: "PUT",
        requestId: headerValue(response.headers, [
          "x-athena-request-id",
          "x-request-id",
          "request-id",
        ]),
        status: response.status,
      },
      resolvedOptions,
      runtimeOptions
    );
  }

  const parsedBody = parseResponseBody(
    rawText ?? "",
    response.headers.get("content-type")
  );
  const requestId = headerValue(response.headers, [
    "x-athena-request-id",
    "x-request-id",
    "request-id",
  ]);
  if (parsedBody.parseFailed) {
    return rejectStorageError(
      {
        code: "INVALID_JSON",
        endpoint,
        message: `Athena storage PUT ${endpoint} returned malformed JSON`,
        method: "PUT",
        raw: parsedBody.parsed,
        requestId,
        status: response.status,
      },
      resolvedOptions,
      runtimeOptions
    );
  }
  if (!response.ok) {
    return rejectStorageError(
      {
        cause: resolveErrorCause(parsedBody.parsed),
        code: "HTTP_ERROR",
        endpoint,
        hint: resolveErrorHint(parsedBody.parsed),
        message: resolveErrorMessage(
          parsedBody.parsed,
          `Athena storage PUT ${endpoint} failed with status ${response.status}`
        ),
        method: "PUT",
        raw: parsedBody.parsed,
        requestId,
        status: response.status,
      },
      resolvedOptions,
      runtimeOptions
    );
  }
  if (!(isRecord(parsedBody.parsed) && "data" in parsedBody.parsed)) {
    return rejectStorageError(
      {
        code: "INVALID_ATHENA_ENVELOPE",
        endpoint,
        message: `Athena storage PUT ${endpoint} returned an invalid Athena envelope`,
        method: "PUT",
        raw: parsedBody.parsed,
        requestId,
        status: response.status,
      },
      resolvedOptions,
      runtimeOptions
    );
  }
  return parsedBody.parsed.data as T;
}

export function createStorageModule(
  gateway: AthenaGatewayClient,
  runtimeOptions?: AthenaStorageClientConfig
): AthenaStorageModule {
  const resolvedRuntimeOptions = runtimeOptions as
    | StorageModuleRuntimeOptions
    | undefined;
  /**
   * Thin JSON route binder: METHOD+path+envelope come only from storageSdkManifest.
   * Hand bodies remain for binary, dual-visibility, and specialized upload helpers.
   */
  const callManifestRoute = <T>(
    name: StorageSdkManifestMethodName,
    args?: {
      body?: unknown;
      options?: AthenaStorageCallOptions;
      pathParams?: Record<string, string>;
      query?: object;
    }
  ): Promise<T> => {
    const route = requireStorageManifestRoute(name);
    if ("binary" in route && route.binary) {
      throw new Error(
        `Storage route ${name} is binary; use specialized binary helpers`
      );
    }
    let path = fillManifestPath(route.path, args?.pathParams);
    if (args?.query) {
      path = appendQuery(path, args.query);
    }
    const method = route.method as AthenaGatewayMethod;
    const routeRuntimeOptions = name.includes("CanonicalStorage")
      ? { ...resolvedRuntimeOptions, stripBasePath: false }
      : resolvedRuntimeOptions;
    return callStorageEndpoint<T>(
      gateway,
      storagePath(path),
      method,
      route.responseEnvelope,
      args?.body,
      args?.options,
      routeRuntimeOptions
    );
  };

  const callStorageFileVisibility = (
    fileId: string,
    method: Extract<AthenaGatewayMethod, "PATCH" | "POST">,
    input: SetStorageFileVisibilityRequest,
    options?: AthenaStorageCallOptions
  ) => {
    const routeName =
      method === "PATCH"
        ? ("setStorageFileVisibility" as const)
        : ("postStorageFileVisibility" as const);
    return callManifestRoute<StorageFileMutationResponse>(routeName, {
      body: input,
      options,
      pathParams: { file_id: fileId },
    });
  };

  const toCanonicalProviderId = (provider: string): StorageProviderId => {
    if (provider === "s3") return "aws_s3";
    if (provider === "r2") return "cloudflare_r2";
    return provider;
  };

  const serializeConnectionInput = (
    input: CreateStorageConnectionInput
  ): Record<string, unknown> => ({
    accessKeyId: input.credentials.accessKeyId,
    bucket: input.config.bucket,
    defaultPrefix: input.config.defaultPrefix,
    description: input.description,
    endpoint: input.config.endpoint,
    forcePathStyle: input.config.forcePathStyle,
    metadata: input.config.metadata,
    name: input.name,
    provider: input.provider,
    publicBaseUrl: input.config.publicBaseUrl,
    region: input.config.region,
    secretAccessKey: input.credentials.secretAccessKey,
    sessionToken: input.credentials.sessionToken,
  });

  const encodeBase64 = (bytes: Uint8Array): string => {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  };

  const providers: AthenaCanonicalStorageProvidersNamespace = {
    async list(options) {
      const result = await callManifestRoute<{
        providers: Array<
          Omit<StorageProviderDescriptor, "id" | "protocol" | "connectionSchema"> & {
            connectionConfig?: { fields?: StorageProviderConnectionField[] };
            provider: string;
          }
        >;
      }>("listCanonicalStorageProviders", { options });
      return result.providers.map((provider) => ({
        connectionSchema: { fields: provider.connectionConfig?.fields ?? [] },
        defaultEndpointTemplate: provider.defaultEndpointTemplate,
        defaultRegion: provider.defaultRegion,
        forcePathStyleDefault: provider.forcePathStyleDefault,
        id: toCanonicalProviderId(provider.provider),
        implementationStatus: provider.implementationStatus,
        integration: provider.integration,
        protocol: "s3_compatible",
      }));
    },
  };

  const connections: AthenaCanonicalStorageConnectionsNamespace = {
    async create(input, options) {
      const result = await callManifestRoute<{ connection: StorageConnection }>(
        "createCanonicalStorageConnection",
        { body: serializeConnectionInput(input), options }
      );
      return result.connection;
    },
    async delete(id, options) {
      return callManifestRoute<{ connectionId: string }>(
        "deleteCanonicalStorageConnection",
        { options, pathParams: { id } }
      );
    },
    async get(id, options) {
      const result = await callManifestRoute<{ connection: StorageConnection }>(
        "getCanonicalStorageConnection",
        { options, pathParams: { id } }
      );
      return result.connection;
    },
    async list(options) {
      const result = await callManifestRoute<{ connections: StorageConnection[] }>(
        "listCanonicalStorageConnections",
        { options }
      );
      return result.connections;
    },
    async test(input, options) {
      return callManifestRoute<{
        config: PublicStorageConnectionConfig;
        ok: boolean;
      }>("testCanonicalStorageConnection", {
        body: serializeConnectionInput(input),
        options,
      });
    },
  };

  const files: AthenaCanonicalStorageFilesNamespace = {
    async delete(fileId, options) {
      const result = await callManifestRoute<{ file: ManagedFile }>(
        "deleteCanonicalStorageFile",
        { options, pathParams: { file_id: fileId } }
      );
      return result.file;
    },
    async get(fileId, options) {
      const result = await callManifestRoute<{ file: ManagedFile }>(
        "getCanonicalStorageFile",
        { options, pathParams: { file_id: fileId } }
      );
      return result.file;
    },
    async list(input, options) {
      const result = await callManifestRoute<{ files: ManagedFile[] }>(
        "listCanonicalStorageFiles",
        { body: input, options }
      );
      return result.files;
    },
    async move(fileId, input, options) {
      const result = await callManifestRoute<{ file: ManagedFile }>(
        "moveCanonicalStorageFile",
        { body: input, options, pathParams: { file_id: fileId } }
      );
      return result.file;
    },
    purge(fileId, options) {
      return callManifestRoute<{ fileId: string }>("purgeCanonicalStorageFile", {
        options,
        pathParams: { file_id: fileId },
      });
    },
    async restore(fileId, options) {
      const result = await callManifestRoute<{ file: ManagedFile }>(
        "restoreCanonicalStorageFile",
        { options, pathParams: { file_id: fileId } }
      );
      return result.file;
    },
    async setVisibility(fileId, input, options) {
      const result = await callManifestRoute<{ file: ManagedFile }>(
        "setCanonicalStorageFileVisibility",
        { body: input, options, pathParams: { file_id: fileId } }
      );
      return result.file;
    },
    async upload(input, options) {
      const result = await callManifestRoute<{ file: ManagedFile }>(
        "uploadCanonicalStorageFile",
        {
          body: {
            ...input,
            body: encodeBase64(input.body),
          },
          options,
        }
      );
      return result.file;
    },
  };

  const permissions: AthenaCanonicalStoragePermissionsNamespace = {
    async grant(fileId, input, options) {
      const result = await callManifestRoute<{ permission: FilePermission }>(
        "grantCanonicalStoragePermission",
        { body: input, options, pathParams: { file_id: fileId } }
      );
      return result.permission;
    },
    async list(fileId, options) {
      const result = await callManifestRoute<{ permissions: FilePermission[] }>(
        "listCanonicalStoragePermissions",
        { options, pathParams: { file_id: fileId } }
      );
      return result.permissions;
    },
    revoke(fileId, input, options) {
      return callManifestRoute<{ fileId: string }>(
        "revokeCanonicalStoragePermission",
        { body: input, options, pathParams: { file_id: fileId } }
      );
    },
  };

  const base: AthenaStorageBaseModule = {
    createStorageCatalog(input, options) {
      return callManifestRoute("createStorageCatalog", {
        body: input,
        options,
      });
    },
    createStorageUploadUrl(input, options) {
      return callManifestRoute("createStorageUploadUrl", {
        body: input,
        options,
      });
    },
    createStorageUploadUrls(input, options) {
      return callManifestRoute("createStorageUploadUrls", {
        body: input,
        options,
      });
    },
    deleteStorageCatalog(id, options) {
      return callManifestRoute("deleteStorageCatalog", {
        options,
        pathParams: { id },
      });
    },
    deleteStorageFile(fileId, options) {
      return callManifestRoute("deleteStorageFile", {
        options,
        pathParams: { file_id: fileId },
      });
    },
    deleteStorageFolder(input, options) {
      return callManifestRoute("deleteStorageFolder", {
        body: input,
        options,
      });
    },
    getStorageFile(fileId, options) {
      return callManifestRoute("getStorageFile", {
        options,
        pathParams: { file_id: fileId },
      });
    },
    getStorageFileProxy(fileId, query, options) {
      const route = requireStorageManifestRoute("getStorageFileProxy");
      const path = appendQuery(
        fillManifestPath(route.path, { file_id: fileId }),
        query
      );
      return callStorageBinaryEndpoint(
        gateway,
        storagePath(path),
        route.method as AthenaGatewayMethod,
        options,
        resolvedRuntimeOptions
      );
    },
    getStorageFileUrl(fileId, query, options) {
      return callManifestRoute("getStorageFileUrl", {
        options,
        pathParams: { file_id: fileId },
        query,
      });
    },
    listStorageCatalogs(options) {
      return callManifestRoute("listStorageCatalogs", { options });
    },
    listStorageCredentials(options) {
      return callManifestRoute("listStorageCredentials", { options });
    },
    listStorageFiles(input, options) {
      return callManifestRoute("listStorageFiles", { body: input, options });
    },
    moveStorageFolder(input, options) {
      return callManifestRoute("moveStorageFolder", { body: input, options });
    },
    setStorageFileVisibility(fileId, input, options) {
      return callStorageFileVisibility(fileId, "PATCH", input, options);
    },
    updateStorageCatalog(id, input, options) {
      return callManifestRoute("updateStorageCatalog", {
        body: input,
        options,
        pathParams: { id },
      });
    },
    updateStorageFile(fileId, input, options) {
      return callManifestRoute("updateStorageFile", {
        body: input,
        options,
        pathParams: { file_id: fileId },
      });
    },
  };
  const multipart: AthenaStorageMultipartNamespace = {
    abort(input, options) {
      return callManifestRoute("abortStorageMultipartUpload", {
        body: input,
        options,
      });
    },
    complete(input, options) {
      return callManifestRoute("completeStorageMultipartUpload", {
        body: input,
        options,
      });
    },
    create(input, options) {
      return callManifestRoute("createStorageMultipartUpload", {
        body: input,
        options,
      });
    },
    listParts(input, options) {
      return callManifestRoute("listStorageMultipartParts", {
        body: input,
        options,
      });
    },
    signPart(input, options) {
      return callManifestRoute("signStorageMultipartPart", {
        body: input,
        options,
      });
    },
  };
  const fileFacade = createStorageFileModule(base, runtimeOptions, multipart);
  const fileUpload = ((
    input:
      | AthenaStorageFileUploadRequest
      | Parameters<AthenaStorageFileModule["upload"]>[0],
    options?: AthenaStorageCallOptions
  ) => {
    if (isRecord(input) && "files" in input) {
      return fileFacade.upload(
        input as unknown as Parameters<AthenaStorageFileModule["upload"]>[0],
        options
      );
    }
    return base
      .createStorageUploadUrl(
        normalizeUploadUrlRequest(input as AthenaStorageFileUploadRequest),
        options
      )
      .then(attachUploadHelper);
  }) as AthenaStorageFileNamespace["upload"];
  const fileDelete = ((
    input: string | readonly string[],
    options?: AthenaStorageCallOptions
  ) =>
    fileFacade.delete(
      input as unknown as Parameters<AthenaStorageFileModule["delete"]>[0],
      options
    )) as AthenaStorageFileNamespace["delete"];

  const file: AthenaStorageFileNamespace = {
    ...fileFacade,
    confirmUpload(fileId, input, options) {
      return callManifestRoute("confirmStorageUpload", {
        body: input ?? {},
        options,
        pathParams: { file_id: fileId },
      });
    },
    copy(fileId, input, options) {
      return callManifestRoute("copyStorageFile", {
        body: input,
        options,
        pathParams: { file_id: fileId },
      });
    },
    delete: fileDelete,
    deleteMany(input, options) {
      return callManifestRoute("deleteManyStorageFiles", {
        body: input,
        options,
      });
    },
    deleteVersion(fileId, versionId, options) {
      return callManifestRoute("deleteStorageFileVersion", {
        options,
        pathParams: { file_id: fileId, version_id: versionId },
      });
    },
    get(fileId, options) {
      return base.getStorageFile(fileId, options);
    },
    proxy(fileId, query, options) {
      return base.getStorageFileProxy(fileId, query, options);
    },
    proxyUrl(fileId, query, options) {
      return callManifestRoute("getStorageFileProxyUrl", {
        options,
        pathParams: { file_id: fileId },
        query,
      });
    },
    publicUrl(fileId, options) {
      return callManifestRoute("getStorageFilePublicUrl", {
        options,
        pathParams: { file_id: fileId },
      });
    },
    purge(fileId, options) {
      return callManifestRoute("purgeStorageFile", {
        options,
        pathParams: { file_id: fileId },
      });
    },
    restore(fileId, options) {
      return callManifestRoute("restoreStorageFile", {
        body: {},
        options,
        pathParams: { file_id: fileId },
      });
    },
    restoreVersion(fileId, versionId, options) {
      return callManifestRoute("restoreStorageFileVersion", {
        body: {},
        options,
        pathParams: { file_id: fileId, version_id: versionId },
      });
    },
    retention: {
      get(fileId, query, options) {
        return callManifestRoute("getStorageFileRetention", {
          options,
          pathParams: { file_id: fileId },
          query,
        });
      },
      set(fileId, input, options) {
        return callManifestRoute("setStorageFileRetention", {
          body: input,
          options,
          pathParams: { file_id: fileId },
        });
      },
    },
    search(input, options) {
      return callManifestRoute("searchStorageFiles", { body: input, options });
    },
    update(fileId, input, options) {
      return base.updateStorageFile(fileId, input, options);
    },
    updateMany(input, options) {
      return callManifestRoute("updateManyStorageFiles", {
        body: input,
        options,
      });
    },
    upload: fileUpload,
    uploadBinary(fileId, body, options) {
      const route = requireStorageManifestRoute("uploadStorageFileBinary");
      return callStorageUploadBinaryEndpoint(
        gateway,
        storagePath(fillManifestPath(route.path, { file_id: fileId })),
        body,
        options,
        resolvedRuntimeOptions
      );
    },
    uploadMany(input, options) {
      return base
        .createStorageUploadUrls(
          { files: input.files.map(normalizeUploadUrlRequest) },
          options
        )
        .then(attachUploadHelpers);
    },
    url(fileId, query, options) {
      return base.getStorageFileUrl(fileId, query, options);
    },
    versions(fileId, options) {
      return callManifestRoute("listStorageFileVersions", {
        options,
        pathParams: { file_id: fileId },
      });
    },
    visibility: {
      set(fileId, input, options) {
        return callStorageFileVisibility(fileId, "POST", input, options);
      },
      setMany(input, options) {
        return callManifestRoute("setManyStorageFileVisibility", {
          body: input,
          options,
        });
      },
      update(fileId, input, options) {
        return base.setStorageFileVisibility(fileId, input, options);
      },
    },
  };
  const credentials: AthenaStorageCredentialsNamespace = {
    list(options) {
      return base.listStorageCredentials(options);
    },
  };
  const catalog: AthenaStorageCatalogNamespace = {
    create(input, options) {
      return base.createStorageCatalog(input, options);
    },
    delete(id, options) {
      return base.deleteStorageCatalog(id, options);
    },
    list(options) {
      return base.listStorageCatalogs(options);
    },
    update(id, input, options) {
      return base.updateStorageCatalog(id, input, options);
    },
  };
  const folder: AthenaStorageFolderNamespace = {
    delete(input, options) {
      return base.deleteStorageFolder(input, options);
    },
    list(input, options) {
      return callManifestRoute("listStorageFolders", { body: input, options });
    },
    move(input, options) {
      return base.moveStorageFolder(input, options);
    },
    tree(input, options) {
      return callManifestRoute("treeStorageFolders", { body: input, options });
    },
  };
  const permission: AthenaStoragePermissionNamespace = {
    check(input, options) {
      return callManifestRoute("checkStoragePermission", {
        body: input,
        options,
      });
    },
    grant(input, options) {
      return callManifestRoute("grantStoragePermission", {
        body: input,
        options,
      });
    },
    list(input, options) {
      return callManifestRoute("listStoragePermissions", {
        body: input,
        options,
      });
    },
    revoke(input, options) {
      return callManifestRoute("revokeStoragePermission", {
        body: input,
        options,
      });
    },
  };
  const objectFolder: AthenaStorageObjectFolderNamespace = {
    create(input, options) {
      return callManifestRoute("createStorageObjectFolder", {
        body: input,
        options,
      });
    },
    delete(input, options) {
      return callManifestRoute("deleteStorageObjectFolder", {
        body: input,
        options,
      });
    },
    rename(input, options) {
      return callManifestRoute("renameStorageObjectFolder", {
        body: input,
        options,
      });
    },
  };
  const object: AthenaStorageObjectNamespace = {
    copy(input, options) {
      return callManifestRoute("copyStorageObject", { body: input, options });
    },
    delete(input, options) {
      return callManifestRoute("deleteStorageObject", { body: input, options });
    },
    deleteVersion(input, options) {
      return callManifestRoute("deleteStorageObjectVersion", {
        body: input,
        options,
      });
    },
    exists(input, options) {
      return callManifestRoute("existsStorageObject", { body: input, options });
    },
    folder: objectFolder,
    head(input, options) {
      return callManifestRoute("headStorageObject", { body: input, options });
    },
    list(input, options) {
      return callManifestRoute("listStorageObjects", { body: input, options });
    },
    postPolicy(input, options) {
      return callManifestRoute("createStorageObjectPostPolicy", {
        body: input,
        options,
      });
    },
    publicUrl(input, options) {
      return callManifestRoute("getStorageObjectPublicUrl", {
        body: input,
        options,
      });
    },
    restoreVersion(input, options) {
      return callManifestRoute("restoreStorageObjectVersion", {
        body: input,
        options,
      });
    },
    update(input, options) {
      return callManifestRoute("updateStorageObject", { body: input, options });
    },
    uploadUrl(input, options) {
      return callManifestRoute("createStorageObjectUploadUrl", {
        body: input,
        options,
      });
    },
    url(input, options) {
      return callManifestRoute("getStorageObjectUrl", { body: input, options });
    },
    validate(input, options) {
      return callManifestRoute("validateStorageObject", {
        body: input,
        options,
      });
    },
    versions(input, options) {
      return callManifestRoute("listStorageObjectVersions", {
        body: input,
        options,
      });
    },
  };
  const bucket: AthenaStorageBucketNamespace = {
    cors: {
      delete(input, options) {
        return callManifestRoute("deleteStorageBucketCors", {
          body: input,
          options,
        });
      },
      get(input, options) {
        return callManifestRoute("getStorageBucketCors", {
          body: input,
          options,
        });
      },
      set(input, options) {
        return callManifestRoute("setStorageBucketCors", {
          body: input,
          options,
        });
      },
    },
    create(input, options) {
      return callManifestRoute("createStorageBucket", { body: input, options });
    },
    delete(input, options) {
      return callManifestRoute("deleteStorageBucket", { body: input, options });
    },
    lifecycle: {
      delete(input, options) {
        return callManifestRoute("deleteStorageBucketLifecycle", {
          body: input,
          options,
        });
      },
      get(input, options) {
        return callManifestRoute("getStorageBucketLifecycle", {
          body: input,
          options,
        });
      },
      set(input, options) {
        return callManifestRoute("setStorageBucketLifecycle", {
          body: input,
          options,
        });
      },
    },
    list(input, options) {
      return callManifestRoute("listStorageBuckets", { body: input, options });
    },
    policy: {
      delete(input, options) {
        return callManifestRoute("deleteStorageBucketPolicy", {
          body: input,
          options,
        });
      },
      get(input, options) {
        return callManifestRoute("getStorageBucketPolicy", {
          body: input,
          options,
        });
      },
      set(input, options) {
        return callManifestRoute("setStorageBucketPolicy", {
          body: input,
          options,
        });
      },
    },
    publicAccess: {
      delete(input, options) {
        return callManifestRoute("deleteStorageBucketPublicAccess", {
          body: input,
          options,
        });
      },
      get(input, options) {
        return callManifestRoute("getStorageBucketPublicAccess", {
          body: input,
          options,
        });
      },
      set(input, options) {
        return callManifestRoute("setStorageBucketPublicAccess", {
          body: input,
          options,
        });
      },
    },
  };
  const audit: AthenaStorageAuditNamespace = {
    list(input, options) {
      return callManifestRoute("listStorageAuditEvents", {
        body: input,
        options,
      });
    },
  };
  const backup = createStorageBackupModule(
    gateway,
    resolvedRuntimeOptions,
    (path, method, payload, options) =>
      callStorageEndpoint(
        gateway,
        storagePath(path),
        method,
        "raw",
        payload,
        options,
        resolvedRuntimeOptions
      )
  );
  return {
    ...base,
    audit,
    backup,
    bucket,
    catalog,
    connections,
    credentials,
    delete: file.delete,
    file,
    files,
    folder,
    multipart,
    object,
    permission,
    permissions,
    providers,
  };
}
