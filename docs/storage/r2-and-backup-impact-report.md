# Report: `@xylex-group/athena` (athena-js) impact of native S3/R2 storage + backups

**Date:** 2026-07-13  
**Server change surface:** `athena-storage-core`, `athena-r2`, `athena-storage`, `athena-s3` provider adapter, backup env (`ATHENA_BACKUP_S3_*`), gateway `/storage/catalogs*`.  
**SDK package:** `packages/athena-js` (`@xylex-group/athena`)

**Compatibility source reviewed:** Cloudflare R2 S3 API compatibility documentation supplied with this review (updated 2026-06-08).

## Summary

| Area | Server change | SDK action required? | Priority |
| --- | --- | --- | --- |
| Managed files / objects / buckets / multipart | Same routes; R2 via S3 API | **No** (existing S3-compatible calls work) | — |
| Storage catalog create/update | Additive: optional `account_id`, optional `endpoint`/`region` for R2 derivation; `provider: "r2"` | **Yes (types + docs)** | Medium |
| Backup admin routes | Env-only S3/R2 profile; HTTP models unchanged | **No** (SDK does not own backup env; admin backup helpers if any stay path-based) | — |
| Auth / headers / storage enable flag | Unchanged (storage is stable; no enable flag) | **No** | — |

**Bottom line (updated):** Runtime file and object operations needed only additive catalog types for R2. **Backups are now part of `client.storage.backup.*`** (admin routes). Archive bucket selection remains server env (`ATHENA_BACKUP_S3_*` S3 or R2); the SDK drives the same APIs as Studio.

## R2 compatibility boundary for Athena storage

R2 is S3-compatible, but it is not a drop-in implementation of every S3 feature. The table below describes the Athena surfaces that matter in practice:

| Athena surface | R2 status | Implementation guidance |
| --- | --- | --- |
| Direct `storage.file.upload(...)` byte PUT | Supported | Uses R2 `PutObject`; `region: "auto"`, path-style addressing, and `Content-Type` are compatible. |
| Managed upload URL and download URL | Supported | Athena metadata and authorization remain server-backed; object transfer uses R2 S3 operations. |
| Object read/list/delete and multipart create/upload/complete/abort/list parts | Supported | Keep using the existing S3-compatible routes. Reusing an R2 multipart part number replaces the prior part. |
| Object metadata updates | Partial | Content metadata is supported, but ACL-preserving paths must not assume ACL APIs exist on R2. |
| ACL and public-access-block operations | Not supported by R2 | Do not advertise ACL, ACL restore, or bucket public-access-block mutations as portable R2 features. |
| Object retention / object lock | Not supported by R2 | `file.retention.*` is S3-only unless a future R2 capability is added. |
| AWS SSE/KMS and bucket-key headers | Not supported by R2 | Do not send standard SSE, KMS key, or bucket-key options to R2. R2 supports SSE-C instead. |
| Object tags and tag-based lifecycle | Not supported by R2 | Keep tags out of R2 upload and lifecycle payloads. |
| Backups | Supported through the server profile | Backup jobs use `ATHENA_BACKUP_S3_*`; the SDK does not expose raw R2 credentials for backup execution. |

The direct browser uploader intentionally signs only the supported object `PUT` path. It does not emulate unsupported ACL, object-lock, tag, or KMS behavior.

---

## What the server now supports

1. **Providers** `s3` and `r2` on storage catalogs and backup env. Request aliases `aws` / `aws_s3` normalize to `s3`; `cloudflare_r2` / `cloudflare-r2` normalize to `r2`.
2. **R2 connection helpers:** derive endpoint from `account_id`, default region `auto`, force path-style.
3. **Shared object client** still uses the S3 SDK; JS continues to send the same endpoint/key/bucket fields for direct object routes.
4. **Backups** read `ATHENA_BACKUP_S3_PROVIDER` / `ATHENA_BACKUP_S3_ACCOUNT_ID` (and existing bucket/key/endpoint vars). No new backup HTTP body fields.

---

## Current JS surface (relevant)

File: `src/storage/module.ts`

```ts
export interface CreateStorageCatalogRequest {
  name: string
  endpoint?: string         // optional for R2 when account_id is supplied
  region?: string           // defaults to auto for R2
  bucket: string
  provider?: string
  account_id?: string
  force_path_style?: boolean
  // ...
  access_key_id: string
  secret_key: string
  metadata?: Record<string, unknown>
}

export interface UpdateStorageCatalogRequest {
  // existing optional fields, including account_id
}
```

Docs: `docs/storage/index.md` describe catalogs as “S3-compatible” only.

The stable storage namespace also exposes typed `client.storage.backup.*` helpers for the existing admin backup routes. Backup credentials remain server/env configuration.

---

## Required / recommended SDK changes

### 1. Types (recommended — additive, non-breaking)

Update `CreateStorageCatalogRequest` / `UpdateStorageCatalogRequest`:

```ts
export interface CreateStorageCatalogRequest {
  name: string
  /** Optional when provider is R2 and account_id (or metadata.account_id) is set. */
  endpoint?: string
  /** Optional; R2 defaults to `auto` after server normalize. */
  region?: string
  bucket: string
  /** `s3` | `r2` plus aliases `aws`, `aws_s3`, `cloudflare_r2`, `cloudflare-r2` (and free-form for other S3-compatible). */
  provider?: string
  /** Cloudflare account ID; derives R2 S3 API endpoint when endpoint omitted. */
  account_id?: string
  force_path_style?: boolean
  default_prefix?: string
  public_base_url?: string
  access_key_id: string
  secret_key: string
  session_token?: string
  metadata?: Record<string, unknown>
}

export interface UpdateStorageCatalogRequest {
  // existing optionals...
  account_id?: string
}
```

Also consider documenting that `metadata.account_id` is accepted server-side even without top-level `account_id`.

### 2. Docs (recommended)

- `docs/storage/index.md` (and mirrored `apps/docs` athena-js pages if synced):  
  - Catalog create with R2 examples  
  - Note path-style / 32-char R2 access key validation  
  - Clarify backups are **not** configured through `client.storage.*`
- Optional: link to server docs [Backups + restore](apps/docs cluster) for operators.

### 3. Runtime behavior (not required)

- No new methods (`createR2Catalog`, etc.) needed.
- No change to `file.*`, `object.*`, `bucket.*`, multipart, or permission APIs.
- No change to OpenAPI client generation for backups unless you later add typed admin backup helpers.

### 4. Tests (recommended if types change)

- Unit/type tests that `CreateStorageCatalogRequest` accepts `{ provider: 'r2', account_id, bucket, access_key_id, secret_key }` without `endpoint`.
- Optional integration test against a local Athena with R2 catalog (credentials-dependent).

### 5. Explicitly out of scope for athena-js

| Concern | Owner |
| --- | --- |
| `ATHENA_BACKUP_S3_*` env for daemon/worker | Deploy / ops / server config |
| R2 adapter implementation | Rust crates `athena-r2` / `athena-storage` |
| Managed file SQL schema | `athena-s3` + provision SQL |
| Changing `provider` column semantics | Server only |

---

## Compatibility notes for existing JS callers

- Callers that already pass full `endpoint` + `region` + keys continue to work for MinIO, AWS, and R2.
- Callers that pass `provider: 's3'` or omit provider: unchanged.
- Tight TypeScript that **requires** `endpoint` and `region` on create will still typecheck with old required fields if you keep them required; making them optional is the only mild type relaxation (still assignable from old objects that include both fields).

---

## Suggested SDK PR checklist

- [ ] Optional `endpoint` / `region` on create catalog types  
- [ ] Add `account_id?: string` to create/update catalog types  
- [ ] Document R2 catalog create in `docs/storage/index.md`  
- [ ] Changelog entry under `@xylex-group/athena` (types/docs only)  
- [ ] No runtime package major version bump required (additive)

---

## Conclusion

**athena-js does not need a functional rewrite for R2 or multi-provider backups.**  
Ship **type + documentation** updates for catalog registration so app developers can use `provider: "r2"` and `account_id` without fighting the TypeScript surface. Backup S3-vs-R2 selection is entirely server-side configuration.
