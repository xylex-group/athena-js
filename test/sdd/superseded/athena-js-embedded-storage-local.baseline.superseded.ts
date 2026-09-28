/**
 * SUPERSEDED by test/sdd/athena-js-embedded-storage-local.target.test.ts
 *
 * Former characterization of pre-implement HEAD (ADR 0027):
 * - B-CFG-01: AthenaStorageConfig has no provider/root
 * - B-TOP-01: local-shaped config is storage transport none
 * - B-TOP-02: topology matrix storage is only none/http/r2
 * - B-CON-01: createClient local-only throws ATHENA_NO_SERVICE_CONFIGURED
 * - B-CON-02: local keys do not materialize storage next to postgres
 * - B-UPL-01: file.upload requires s3_id or s3Id (HTTP still true)
 * - B-UPL-02: files.upload is catalog-gated on connectionId + service path
 * - B-OBJ-01: storage.object.head is remote HTTP
 * - B-ERR-01: ATHENA_STORAGE_CAPABILITY_UNSUPPORTED does not exist
 * - B-R2-01: L3a rejects .. and unsupported catalog is generic Error
 * - B-MAN-01: storageSdkManifest is a live HTTP inventory (>= 70)
 *
 * Active baseline file deleted after implement: provider/root, transport
 * "local", and ATHENA_STORAGE_CAPABILITY_UNSUPPORTED inverted the
 * characterization. Target suite is the CI source of truth.
 *
 * Kept as a record only (not a *.test.ts file so CI does not run it).
 */
export const SUPERSEDED_BY =
  "test/sdd/athena-js-embedded-storage-local.target.test.ts";

export const SUPERSEDED_IDS = [
  "B-CFG-01",
  "B-TOP-01",
  "B-TOP-02",
  "B-CON-01",
  "B-CON-02",
  "B-UPL-01",
  "B-UPL-02",
  "B-OBJ-01",
  "B-ERR-01",
  "B-R2-01",
  "B-MAN-01",
] as const;
