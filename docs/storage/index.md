# Athena Storage SDK

This section documents the storage surface that is currently exposed by `@xylex-group/athena`.

The JavaScript SDK has two storage layers to be aware of:

- `client.storage.*`: the experimental managed-storage SDK namespace in this package.
- Athena server OpenAPI storage routes: lower-level bucket/object endpoints exposed by the Athena server. The JS SDK wraps the current storage parity surface under grouped `file`, `folder`, `permission`, `object`, `bucket`, `multipart`, and `audit` namespaces.

## Enable the SDK storage namespace

Storage bindings are behind an experimental opt-in. A default client does not include `.storage`.

```ts
import { AthenaStorageError, createClient } from "@xylex-group/athena"

const athena = createClient(process.env.ATHENA_URL!, process.env.ATHENA_API_KEY!, {
  client: "app_primary",
  experimental: {
    athenaStorageBackend: true,
    storage: {
      prefixPath: "organizations/{organization_id}/documents/{env.APP_ENV}",
      env: {
        APP_ENV: process.env.APP_ENV,
      },
      onError(error) {
        console.error(error.code, error.athenaCode, error.kind, error.toDetails())
      },
    },
  },
})
```

The `client` option is important for managed storage. The SDK sends it as `X-Athena-Client`, and Athena uses that client database when resolving storage catalogs, credentials, and managed file metadata.

`experimental.storage.prefixPath` is used by the high-level `athena.storage.file.*` helpers. It is prepended to upload keys and list prefixes. Templates support values from call options, per-call `vars`, config `vars`, and env values:

```ts
const athena = createClient(url, apiKey, {
  client: "app_primary",
  experimental: {
    athenaStorageBackend: true,
    storage: {
      prefixPath: "organizations/{organization_id}/uploads/{env.APP_ENV}",
      vars: { organization_id: "org_fallback" },
      env: { APP_ENV: process.env.APP_ENV },
    },
  },
})
```

Supported token forms are `{organization_id}`, `{organizationId}`, `{user_id}`, `{userId}`, `{resource_id}`, `{resourceId}`, `{env.NAME}`, and `${NAME}`. In browser bundles, pass `env` explicitly because `process.env` is usually not available.

The builder form narrows the returned type as well:

```ts
import { AthenaClient } from "@xylex-group/athena"

const athena = AthenaClient.builder()
  .url(process.env.ATHENA_URL!)
  .key(process.env.ATHENA_API_KEY!)
  .client("app_primary")
  .experimental({ athenaStorageBackend: true })
  .build()
```

## SDK method map

These are the methods currently exposed by `AthenaStorageModule`.

| SDK method | HTTP route | Envelope | Return type | Purpose |
| --- | --- | --- | --- | --- |
| `listStorageCatalogs()` | `GET /storage/catalogs` | Raw JSON | `{ data: S3CatalogItem[] }` | List registered S3-compatible catalogs for the selected Athena client. |
| `createStorageCatalog(input)` | `POST /storage/catalogs` | Raw JSON | `S3CatalogItem` | Register a catalog and its initial credential. |
| `updateStorageCatalog(id, input)` | `PATCH /storage/catalogs/{id}` | Raw JSON | `S3CatalogItem` | Update catalog connection fields, credential fields, metadata, or active state. |
| `deleteStorageCatalog(id)` | `DELETE /storage/catalogs/{id}` | Raw JSON | `{ id: string; deleted: boolean }` | Delete a registered catalog. |
| `listStorageCredentials()` | `GET /storage/credentials` | Raw JSON | `{ data: S3CredentialListItem[] }` | List credential records associated with catalogs. |
| `createStorageUploadUrl(input)` | `POST /storage/files/upload-url` | Athena envelope | `StorageUploadUrlResponse` | Create or update managed file metadata and return one presigned upload URL. |
| `createStorageUploadUrls(input)` | `POST /storage/files/upload-urls` | Athena envelope | `StorageBatchUploadUrlResponse` | Create multiple managed file upload URLs. |
| `listStorageFiles(input)` | `POST /storage/files/list` | Athena envelope | `StorageListFilesResponse` | List managed file records under a catalog prefix. |
| `getStorageFile(fileId)` | `GET /storage/files/{file_id}` | Athena envelope | `StorageFileMutationResponse` | Load one managed file record. |
| `getStorageFileUrl(fileId, query)` | `GET /storage/files/{file_id}/url` | Athena envelope | `PresignedFileUrlResponse` | Return a presigned object URL while preserving the managed file path. |
| `getStorageFileProxy(fileId, query)` | `GET /storage/files/{file_id}/proxy` | Raw binary response | `Response` | Stream/download/read through Athena authorization without forcing JSON parsing. |
| `updateStorageFile(fileId, input)` | `PATCH /storage/files/{file_id}` | Athena envelope | `StorageFileMutationResponse` | Update a managed file storage key and optional bucket. |
| `deleteStorageFile(fileId)` | `DELETE /storage/files/{file_id}` | Athena envelope | `StorageFileMutationResponse` | Mark or delete a managed file. |
| `setStorageFileVisibility(fileId, input)` | `PATCH /storage/files/{file_id}/visibility` | Athena envelope | `StorageFileMutationResponse` | Toggle public visibility for a managed file. |
| `deleteStorageFolder(input)` | `POST /storage/folders/delete` | Athena envelope | `StorageFolderMutationResponse` | Delete every managed file below a prefix. |
| `moveStorageFolder(input)` | `POST /storage/folders/move` | Athena envelope | `StorageFolderMutationResponse` | Move every managed file below one prefix to another prefix. |
| `file.upload(input)` | `POST /storage/files/upload-url` or `/upload-urls`, then presigned `PUT` | Athena envelope + binary upload | `AthenaStorageFileUploadResult` | Validate local files, create managed upload URLs, upload bytes, and report progress. |
| `file.download(fileId, query)` | `GET /storage/files/{file_id}/proxy` | Raw binary response | `Response` | Download or stream one managed file through Athena authorization. |
| `file.download(fileIds, query)` | `GET /storage/files/{file_id}/proxy` per id | Raw binary response | `Response[]` | Download or stream multiple managed files. |
| `file.list(input)` | `POST /storage/files/list` | Athena envelope | `StorageListFilesResponse` | List managed files under the configured prefix path. |
| `file.delete(fileId)` | `DELETE /storage/files/{file_id}` | Athena envelope | `StorageFileMutationResponse` | Delete one managed file by id. |
| `file.delete(fileIds)` | `DELETE /storage/files/{file_id}` per id | Athena envelope | `StorageFileMutationResponse[]` | Delete multiple managed files. |
| `delete(fileIdOrIds)` | Same as `file.delete(...)` | Athena envelope | `StorageFileMutationResponse` or array | Short alias for file deletion. |
| `file.search(input)` | `POST /storage/files/search` | Athena envelope | `StorageListFilesResponse` | Search managed files with pagination and optional metadata/name/resource/status/visibility filters. |
| `file.update(fileId, input)` / `file.updateMany(input)` | `PATCH /storage/files/{file_id}` / `POST /storage/files/update-many` | Athena envelope | `StorageFileMutationResponse` / `StorageFileMutationManyResponse` | Move files and/or patch mutable metadata fields. |
| `file.copy(fileId, input)` | `POST /storage/files/{file_id}/copy` | Athena envelope | `StorageFileMutationResponse` | Copy a managed file, with optional server-side encryption headers. |
| `file.proxyUrl(fileId, query)` | `GET /storage/files/{file_id}/proxy-url` | Athena envelope | `Record<string, unknown>` | Resolve the Athena proxy URL string for a managed file. |
| `file.versions(fileId)` | `GET /storage/files/{file_id}/versions` | Athena envelope | `Record<string, unknown>` | List S3 object versions for a managed file. |
| `file.restoreVersion(fileId, versionId)` | `POST /storage/files/{file_id}/versions/{version_id}/restore` | Athena envelope | `Record<string, unknown>` | Restore a managed file object version. |
| `file.deleteVersion(fileId, versionId)` | `DELETE /storage/files/{file_id}/versions/{version_id}` | Athena envelope | `Record<string, unknown>` | Delete a managed file object version. |
| `file.retention.get(fileId, query)` / `file.retention.set(fileId, input)` | `GET/POST /storage/files/{file_id}/retention` | Athena envelope | `Record<string, unknown>` | Read or set S3 object-lock retention for a managed file. |
| `object.*` | `POST /storage/objects/*` | Athena envelope | `Record<string, unknown>` | Raw object list/head/exists/validate/update/copy/url/public-url/delete/upload-url/version/post-policy operations. |
| `bucket.*` | `POST /storage/buckets/*` | Athena envelope | `Record<string, unknown>` | Raw bucket list/create/delete plus lifecycle, policy, public-access, and CORS operations. |
| `multipart.*` | `POST /storage/multipart/*` | Athena envelope | `Record<string, unknown>` or `StorageFileMutationResponse` | Managed multipart create/sign-part/complete/abort/list-parts operations. |
| `permission.*` / `audit.list(input)` | `POST /storage/permissions/*` and `/storage/audit/list` | Athena envelope | Permission/audit response types | Managed file permission and audit event operations. |

Raw JSON endpoints return the parsed response body. Athena-envelope endpoints unwrap `{ status, message, data }` and return `data`. The binary proxy endpoint returns the original `Response` on success.

## Types

```ts
interface S3CatalogItem {
  id: string
  name: string
  description: string
  endpoint: string
  region: string
  bucket?: string | null
  provider: string
  is_active: boolean
  active_credential_id?: string | null
  active_access_key?: string | null
  created_at: string
  updated_at: string
}

interface S3CredentialListItem {
  id: string
  s3_id: string
  name: string
  description: string
  endpoint: string
  region: string
  bucket?: string | null
  provider: string
  access_key: string
  created_at: string
  updated_at: string
}

interface ManagedFileRecord {
  id: string
  name: string
  original_name?: string | null
  url?: string | null
  bucket: string
  s3_id?: string | null
  prefix_path?: string | null
  size_bytes?: number | null
  mime_type?: string | null
  resource_id?: string | null
  organization_id: string
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
  storage_key: string
  uploaded_by_user_id?: string | null
  extension?: string | null
  is_public: boolean
  status: string
  deleted_at?: string | null
}

type StorageFileAccessPurpose = "read" | "download" | "stream"

interface GetStorageFileUrlQuery {
  purpose?: StorageFileAccessPurpose | (string & {})
}

interface AthenaStorageFileUploadInput {
  s3_id: string
  bucket?: string
  files: Blob | ArrayBuffer | Uint8Array | ArrayLike<Blob | ArrayBuffer | Uint8Array>
  storage_key?: string
  storageKey?: string
  storageKeyTemplate?: string
  prefixPath?: string
  fileName?: string
  maxFiles?: number
  allowedExtensions?: string[]
  extensions?: string[]
  maxFileSizeMb?: number
  maxFileSizeBytes?: number
  public?: boolean
  metadata?: Record<string, unknown>
  vars?: Record<string, string | number | boolean | null | undefined>
  env?: Record<string, string | undefined>
  onProgress?: (progress: AthenaStorageUploadProgress) => void
}

interface AthenaStorageUploadProgress {
  phase: "preparing" | "uploading" | "complete"
  fileIndex: number
  fileCount: number
  fileName: string
  loaded: number
  total: number
  percent: number
  aggregateLoaded: number
  aggregateTotal: number
  aggregatePercent: number
}
```

`GetStorageFileUrlQuery` stays string-compatible so existing presigned URL purposes keep working if the server accepts additional purpose values later. For the proxy route, the current known purposes are `read`, `download`, and `stream`.

Presigned upload responses can include signed request headers. The high-level `file.upload(...)` helper and the low-level `upload.put(...)` helper replay those headers automatically.

Server-side encryption options are additive on supported upload/copy/multipart/post-policy inputs:

```ts
type StorageServerSideEncryptionOptions = {
  server_side_encryption?: "AES256" | "aws:kms" | "aws:kms:dsse" | (string & {})
  sse?: "AES256" | "aws:kms" | "aws:kms:dsse" | (string & {})
  ssekms_key_id?: string
  kms_key_id?: string
  bucket_key_enabled?: boolean
}
```

Managed file list and search inputs accept pagination plus filters:

```ts
const page = await athena.storage.file.search({
  query: "invoice",
  limit: 50,
  offset: 0,
  s3_id: "8f915f08-29f7-4dc0-9c6b-bucket-id",
  key_prefix: "organizations/org_1/",
  metadata: { type: "invoice" },
  visibility: "private",
})
```

Proxy downloads can pass `Range` through normal storage call headers:

```ts
const partial = await athena.storage.file.proxy(
  "file_1",
  { purpose: "stream" },
  { headers: { Range: "bytes=0-1023" } },
)
```

Raw object and bucket administration methods use the common ad hoc credential shape:

```ts
const s3 = {
  endpoint: "https://s3.us-east-1.amazonaws.com",
  region: "us-east-1",
  access_key_id: process.env.S3_ACCESS_KEY_ID!,
  secret_key: process.env.S3_SECRET_ACCESS_KEY!,
  bucket: "acme-documents",
}

await athena.storage.object.validate({
  ...s3,
  key: "reports/q1.pdf",
  checksum_sha256: "expected-sha256",
})

await athena.storage.object.postPolicy({
  ...s3,
  key: "browser/q1.pdf",
  content_type: "application/pdf",
  server_side_encryption: "AES256",
})

await athena.storage.bucket.lifecycle.set({
  ...s3,
  rules: [{ id: "expire-tmp", prefix: "tmp/", expiration_days: 7 }],
})

await athena.storage.bucket.publicAccess.set({
  ...s3,
  block_public_acls: true,
  ignore_public_acls: true,
  block_public_policy: true,
  restrict_public_buckets: true,
})
```

Managed file versions and retention are grouped under `file`:

```ts
const versions = await athena.storage.file.versions("file_1")

await athena.storage.file.restoreVersion("file_1", "version_1")

await athena.storage.file.retention.set("file_1", {
  mode: "GOVERNANCE",
  retain_until: "2026-07-01T00:00:00Z",
})
```

## Catalogs and credentials

Use catalogs when you want Athena to store and reuse S3-compatible connection settings for a selected Athena client.

```ts
const created = await athena.storage.createStorageCatalog({
  name: "documents",
  description: "Private document bucket",
  endpoint: "https://s3.us-east-1.amazonaws.com",
  region: "us-east-1",
  bucket: "acme-documents",
  provider: "s3",
  access_key_id: process.env.S3_ACCESS_KEY_ID!,
  secret_key: process.env.S3_SECRET_ACCESS_KEY!,
  metadata: {
    environment: "production",
  },
})

const catalogs = await athena.storage.listStorageCatalogs()
const active = catalogs.data.find(catalog => catalog.is_active)
```

Update catalog fields and rotate credentials through the same method:

```ts
await athena.storage.updateStorageCatalog(created.id, {
  description: "Document bucket with rotated credentials",
  access_key_id: process.env.S3_ACCESS_KEY_ID_NEXT!,
  secret_key: process.env.S3_SECRET_ACCESS_KEY_NEXT!,
  is_active: true,
})
```

Credential records can be listed separately:

```ts
const credentials = await athena.storage.listStorageCredentials()
for (const credential of credentials.data) {
  console.log(credential.s3_id, credential.access_key, credential.created_at)
}
```

## Convenience file API

Use `athena.storage.file.upload(...)` when the SDK should create the managed file record and perform the presigned upload in one call.

```ts
const result = await athena.storage.file.upload(
  {
    s3_id: "s3_1",
    bucket: "acme-documents",
    files: selectedFile,
    fileName: selectedFile.name,
    extensions: ["pdf"],
    maxFileSizeMb: 25,
    metadata: {
      source: "reports-ui",
    },
    onProgress(progress) {
      console.log(progress.aggregatePercent)
    },
  },
  { organizationId: "org_1" },
)

const uploadedFile = result.files[0].file
console.log(uploadedFile.id, uploadedFile.storage_key)
```

`maxFiles` defaults to `1`. Raise it for multi-file input:

```ts
const batch = await athena.storage.file.upload({
  s3_id: "s3_1",
  bucket: "acme-documents",
  files: fileInput.files,
  maxFiles: 5,
  extensions: ["pdf", "docx", "txt"],
  maxFileSizeMb: 25,
  storageKeyTemplate: "reports/{organization_id}/{index}-{fileName}",
  vars: {
    organization_id: "org_1",
  },
})

for (const item of batch.files) {
  console.log(item.file.id, item.storage_key)
}
```

The upload helper uses `XMLHttpRequest` in browsers so `onProgress` receives real upload progress. In runtimes without XHR it falls back to `fetch`, reports start and completion, and still returns the presigned upload `Response`.

List, download, and delete through the same facade:

```ts
const page = await athena.storage.file.list({
  s3_id: "s3_1",
  prefix: "reports",
})

const response = await athena.storage.file.download("file_1", {
  purpose: "download",
})
const bytes = await response.arrayBuffer()

const responses = await athena.storage.file.download(["file_1", "file_2"], {
  purpose: "stream",
})

await athena.storage.file.delete("file_1")
await athena.storage.delete(["file_2", "file_3"])
```

## React upload hook

React apps can use `useStorageUpload` from `@xylex-group/athena/react`.

```tsx
import type { AthenaStorageModule } from "@xylex-group/athena"
import { useStorageUpload } from "@xylex-group/athena/react"

function ReportUpload({ athena }: { athena: { storage: AthenaStorageModule } }) {
  const upload = useStorageUpload({
    storage: athena.storage,
    s3_id: "s3_1",
    bucket: "acme-documents",
    maxFileSizeMb: 25,
    extensions: ["pdf"],
  })

  return (
    <form
      onSubmit={async event => {
        event.preventDefault()
        const form = new FormData(event.currentTarget)
        const file = form.get("file")
        if (file instanceof Blob) {
          await upload.upload(file)
        }
      }}
    >
      <input name="file" type="file" accept=".pdf" />
      <progress value={upload.percent} max={100} />
      <button type="submit" disabled={upload.uploading}>
        Upload
      </button>
    </form>
  )
}
```

The hook returns `{ uploading, progress, percent, error, result, upload, abort, reset }`. `progress` is the latest `AthenaStorageUploadProgress` snapshot, and `abort()` cancels the active XHR/fetch when the runtime supports `AbortSignal`.

## Low-level upload URLs

`createStorageUploadUrl(...)` creates managed file metadata and returns the presigned upload target.

```ts
const { file, upload } = await athena.storage.createStorageUploadUrl({
  s3_id: "s3_1",
  bucket: "acme-documents",
  storage_key: "reports/q2.pdf",
  name: "q2.pdf",
  original_name: "Q2 Report.pdf",
  resource_id: "report_q2",
  mime_type: "application/pdf",
  content_type: "application/pdf",
  size_bytes: 1_048_576,
  public: false,
  metadata: {
    report_type: "quarterly",
  },
})

await fetch(upload.url, {
  method: "PUT",
  headers: {
    "Content-Type": "application/pdf",
  },
  body: await selectedFile.arrayBuffer(),
})

console.log(file.id, upload.expires_at)
```

Use the batch method when the UI already has multiple files:

```ts
const batch = await athena.storage.createStorageUploadUrls({
  files: [
    {
      s3_id: "s3_1",
      storage_key: "reports/q2.pdf",
      content_type: "application/pdf",
    },
    {
      s3_id: "s3_1",
      storage_key: "reports/q2-summary.txt",
      content_type: "text/plain",
    },
  ],
})

for (const item of batch.files) {
  console.log(item.file.id, item.upload.url)
}
```

## List and read managed files

The SDK file APIs operate on Athena-managed file records, not only raw S3 objects.

```ts
const page = await athena.storage.listStorageFiles({
  s3_id: "s3_1",
  prefix: "reports/",
})

for (const file of page.files) {
  console.log(file.id, file.storage_key, file.size_bytes)
}
```

Load one file record by id:

```ts
const { file } = await athena.storage.getStorageFile("file_1")
console.log(file.name, file.is_public, file.status)
```

Get a presigned read URL:

```ts
const url = await athena.storage.getStorageFileUrl("file_1", {
  purpose: "download",
})

window.location.href = url.url
```

Use the proxy route when the response body should flow through Athena authorization:

```ts
const response = await athena.storage.getStorageFileProxy("file_1", {
  purpose: "stream",
})

if (!response.ok) {
  throw new Error(`Unexpected proxy status ${response.status}`)
}

const contentType = response.headers.get("content-type")
const disposition = response.headers.get("content-disposition")
const bytes = await response.arrayBuffer()

console.log(contentType, disposition, bytes.byteLength)
```

On success, `getStorageFileProxy(...)` returns the raw `Response`. That preserves headers such as `Content-Type`, `Content-Disposition`, `Content-Length`, `ETag`, and `Cache-Control`. On non-2xx responses, the SDK still throws `AthenaStorageError`.

## Mutate files and folders

Update the stored key or bucket for one managed file:

```ts
const updated = await athena.storage.updateStorageFile("file_1", {
  storage_key: "reports/archive/q2.pdf",
  bucket: "acme-documents",
})

console.log(updated.file.storage_key)
```

Toggle visibility:

```ts
await athena.storage.setStorageFileVisibility("file_1", {
  public: true,
})
```

Delete one file:

```ts
await athena.storage.deleteStorageFile("file_1")
```

Move or delete a managed folder prefix:

```ts
await athena.storage.moveStorageFolder({
  s3_id: "s3_1",
  from_prefix: "reports/drafts/",
  to_prefix: "reports/archive/drafts/",
})

await athena.storage.deleteStorageFolder({
  s3_id: "s3_1",
  prefix: "reports/tmp/",
})
```

Folder operations return `processed_files`, which is the number of managed file records touched by the operation.

## Error handling

Storage failures throw `AthenaStorageError`.

```ts
try {
  await athena.storage.listStorageFiles({
    s3_id: "missing",
    prefix: "reports/",
  })
} catch (error) {
  if (error instanceof AthenaStorageError) {
    console.error(error.code)
    console.error(error.athenaCode)
    console.error(error.kind)
    console.error(error.status)
    console.error(error.requestId)
    console.error(error.toDetails())
  }
  throw error
}
```

Register a global observer through `experimental.storage.onError`, or pass a per-call observer:

```ts
await athena.storage.getStorageFile("file_1", {
  onError(error) {
    console.error("storage request failed", error.endpoint, error.code)
  },
})
```

Observer errors are ignored so they do not replace the original storage failure.

## Server OpenAPI storage routes

The routes below exist in the Athena server OpenAPI reference and are exposed through grouped `client.storage.*` namespaces. They are useful when you need to map a server route to the SDK method name.

| Server route | Purpose | Request shape | SDK coverage |
| --- | --- | --- | --- |
| [`POST /storage/buckets/list`](https://docs.athena-cluster.com/docs/reference/athena-openapi/storage/buckets/list/post) | List accessible buckets for supplied S3-compatible credentials. | `endpoint`, `region`, `access_key_id`, `secret_key` | `bucket.list(input)` |
| [`POST /storage/buckets/create`](https://docs.athena-cluster.com/docs/reference/athena-openapi/storage/buckets/create/post) | Create a bucket. | Common credential fields plus `bucket` | `bucket.create(input)` |
| [`POST /storage/buckets/delete`](https://docs.athena-cluster.com/docs/reference/athena-openapi/storage/buckets/delete/post) | Delete an empty bucket. | Common credential fields plus `bucket` | `bucket.delete(input)` |
| `POST /storage/buckets/lifecycle`, `/set`, `/delete` | Read, set, or delete lifecycle rules. | Common credential fields plus lifecycle `rules` for set. | `bucket.lifecycle.get/set/delete(input)` |
| `POST /storage/buckets/policy`, `/set`, `/delete` | Read, set, or delete bucket policy. | Common credential fields plus `policy` for set. | `bucket.policy.get/set/delete(input)` |
| `POST /storage/buckets/public-access`, `/set`, `/delete` | Read, set, or delete public-access block configuration. | Common credential fields plus public access booleans for set. | `bucket.publicAccess.get/set/delete(input)` |
| [`POST /storage/objects`](https://docs.athena-cluster.com/docs/reference/athena-openapi/storage/objects/post) | List objects using S3 `ListObjectsV2`. | Common credential fields plus `bucket`, optional `prefix`, `delimiter`, `continuation_token`, `max_keys` | `object.list(input)` |
| [`POST /storage/objects/head`](https://docs.athena-cluster.com/docs/reference/athena-openapi/storage/objects/head/post) | Load object metadata without downloading the body. | Common credential fields plus `bucket`, `key` | `object.head(input)` |
| `POST /storage/objects/exists` / `/validate` | Check object existence or validate checksum/ETag. | Common credential fields plus `bucket`, `key`, optional `checksum_sha256` or `etag`. | `object.exists(input)` / `object.validate(input)` |
| [`POST /storage/objects/update`](https://docs.athena-cluster.com/docs/reference/athena-openapi/storage/objects/update/post) | Update object headers and/or ACL. | Common credential fields plus `bucket`, `key`, optional ACL/header/metadata fields | `object.update(input)` |
| [`POST /storage/objects/url`](https://docs.athena-cluster.com/docs/reference/athena-openapi/storage/objects/url/post) | Generate a presigned GET URL for a raw object. | Common credential fields plus `bucket`, `key` | `object.url(input)` |
| [`POST /storage/objects/upload-url`](https://docs.athena-cluster.com/docs/reference/athena-openapi/storage/objects/upload-url/post) | Generate a presigned PUT URL for a raw object. | Common credential fields plus `bucket`, `key`, optional `content_type` and SSE fields | `object.uploadUrl(input)` |
| `POST /storage/objects/post-policy` | Generate a signed POST policy for browser uploads. | Common credential fields plus `bucket`, `key`, size/content/SSE options. | `object.postPolicy(input)` |
| `POST /storage/objects/versions`, `/restore`, `/delete` | List, restore, or delete raw object versions. | Common credential fields plus object key/version fields. | `object.versions/restoreVersion/deleteVersion(input)` |
| [`POST /storage/objects/folder`](https://docs.athena-cluster.com/docs/reference/athena-openapi/storage/objects/folder/post) | Create a folder placeholder/prefix. | Common credential fields plus `bucket`, `prefix` | `object.folder.create(input)` |
| `POST /storage/objects/folder/delete`, `/rename` | Delete or rename raw object folder prefixes. | Common credential fields plus prefix fields. | `object.folder.delete/rename(input)` |
| [`POST /storage/objects/delete`](https://docs.athena-cluster.com/docs/reference/athena-openapi/storage/objects/delete/post) | Delete a raw object. | Common credential fields plus `bucket`, `key` | `object.delete(input)` |
| [`POST /storage/buckets/cors`](https://docs.athena-cluster.com/docs/reference/athena-openapi/storage/buckets/cors/post) | Read bucket CORS configuration. | Common credential fields plus `bucket` | `bucket.cors.get(input)` |
| [`POST /storage/buckets/cors/set`](https://docs.athena-cluster.com/docs/reference/athena-openapi/storage/buckets/cors/set/post) | Apply bucket CORS rules. | Common credential fields plus `bucket`, `rules` | `bucket.cors.set(input)` |
| [`POST /storage/buckets/cors/delete`](https://docs.athena-cluster.com/docs/reference/athena-openapi/storage/buckets/cors/delete/post) | Remove bucket CORS configuration. | Common credential fields plus `bucket` | `bucket.cors.delete(input)` |

Common credential fields are:

```ts
type RawStorageCredentialFields = {
  endpoint: string
  region: string
  access_key_id: string
  secret_key: string
}
```

A direct call helper can still be useful for testing custom server builds or routes newer than the installed SDK:

```ts
async function callRawStorageRoute<TResponse>(
  baseUrl: string,
  apiKey: string,
  path: string,
  body: unknown,
  client?: string,
): Promise<TResponse> {
  const response = await fetch(`${baseUrl.replace(/\/+$/, "")}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Athena-Key": apiKey,
      ...(client ? { "X-Athena-Client": client } : {}),
    },
    body: JSON.stringify(body),
  })

  const payload = await response.json()
  if (!response.ok) {
    throw new Error(typeof payload?.message === "string" ? payload.message : `Storage request failed: ${response.status}`)
  }
  return payload as TResponse
}

const buckets = await callRawStorageRoute(
  process.env.ATHENA_URL!,
  process.env.ATHENA_API_KEY!,
  "/storage/buckets/list",
  {
    endpoint: "https://s3.us-east-1.amazonaws.com",
    region: "us-east-1",
    access_key_id: process.env.S3_ACCESS_KEY_ID!,
    secret_key: process.env.S3_SECRET_ACCESS_KEY!,
  },
  "app_primary",
)
```

Use the SDK methods first when you are working with Athena-managed catalogs and files. Use direct OpenAPI calls only when you need low-level bucket/object administration that the SDK does not currently wrap.
