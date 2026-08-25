# ADR 0027: Embedded storage runtime (catalog optional)

**Date:** 19 August 2026  
**Status:** Accepted  
**Author:** Floris  
**Accepted by:** Floris  
**Depends on:** [0011](0011-graduate-storage-into-base-client.md), [0012](0012-stable-service-namespaces-and-options.md), [0015](0015-execution-transport-and-cloudflare-edge.md), [0016](0016-drop-in-edge-bindings-on-create-client.md)  
**Monorepo record:** [`docs/adr/technical/0027-athena-js-embedded-storage-runtime.md`](../../../../docs/adr/technical/0027-athena-js-embedded-storage-runtime.md)  
**SDD:** [`docs/sdd/xylex/athena-js-embedded-storage-runtime-finality/SPEC.md`](../../../../docs/sdd/xylex/athena-js-embedded-storage-runtime-finality/SPEC.md)

## Context

Storage graduated into `createClient().storage` (0011) and R2 became a drop-in execution binding (0016). Managed file APIs still required a persisted Athena catalog (`s3_id` / `connectionId`). Node had no local ObjectStore analog to direct PostgreSQL.

## Decision

`athena.storage` = canonical API + storage runtime + **optional** catalog control plane.

- **StorageBackend** executes bytes.
- **StorageConnection** is an execution adapter handle, not necessarily a catalog row.
- **StorageCatalog** is optional metadata.

Trusted Node: `createClient({ storage: { provider: "local", root } })` uploads/gets/heads/deletes/lists via existing `athena.storage.file.*` without catalog IDs. Reject `..`, NUL, and root escape. Unsupported ops use `ATHENA_STORAGE_CAPABILITY_UNSUPPORTED`. No second public factory. Do not shrink `storageSdkManifest`.

Browser / React Native reject `provider: "local"` with `ATHENA_STORAGE_LOCAL_NODE_REQUIRED`. The filesystem adapter is imported only from Node `v3-client.ts`.

## Non-goals

R2 rewrite, S3 SDK adapter (this slice), multipart rewrite, module decomposition, browser secret plumbing, UI, HTTP 3000-band codes for adapter gaps.

Direct S3 is companion monorepo [ADR 0057](../../../../docs/adr/technical/0057-athena-js-direct-s3-storage-provider.md) — not a reopen of this record.

## Consequences

- `AthenaStorageConfig` has `provider` / `root`. `AthenaStorageTransport` includes `local`.
- `storage.file.upload|get|head|delete|list` are catalog-optional on the local runtime; remote gates stay.
- JS error catalog gains `ATHENA_STORAGE_CAPABILITY_UNSUPPORTED` (`AthenaStorageCapabilityError`). Not added to `contracts/storage/errors.json`.

## Validation

Target dual-suite GREEN: `test/sdd/athena-js-embedded-storage-local.target.test.ts`. Baseline characterizes pre-implement HEAD and is superseded.
