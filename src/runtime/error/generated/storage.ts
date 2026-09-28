/* AUTO-GENERATED from contracts/storage/errors.json. Do not hand-edit. */
import type { AthenaErrorIR } from "../ir.ts";

export const ATHENA_STORAGE_ERROR_DESCRIPTORS: readonly AthenaErrorIR<string, "storage">[] =
	Object.freeze([
	  {
	    "code": "storage_invalid_request",
	    "description": "Caller-correctable storage request validation failure.",
	    "domain": "storage",
	    "errorNumber": 3000,
	    "kind": "validation",
	    "retry": "never",
	    "status": 400
	  },
	  {
	    "code": "storage_invalid_provider",
	    "description": "Unknown storage provider label rejected without AWS fallback.",
	    "domain": "storage",
	    "errorNumber": 3001,
	    "kind": "validation",
	    "retry": "never",
	    "status": 400
	  },
	  {
	    "code": "storage_unsupported_provider",
	    "description": "Storage provider is recognized but not implemented.",
	    "domain": "storage",
	    "errorNumber": 3002,
	    "kind": "unsupported",
	    "retry": "never",
	    "status": 400
	  },
	  {
	    "code": "storage_authorization_denied",
	    "description": "Caller is not authorized for the storage operation.",
	    "domain": "storage",
	    "errorNumber": 3003,
	    "kind": "authorization",
	    "retry": "never",
	    "status": 403
	  },
	  {
	    "code": "storage_connection_not_found",
	    "description": "Storage connection or related resource was not found.",
	    "domain": "storage",
	    "errorNumber": 3004,
	    "kind": "not_found",
	    "retry": "never",
	    "status": 404
	  },
	  {
	    "code": "storage_file_not_found",
	    "description": "Managed file or permission was not found.",
	    "domain": "storage",
	    "errorNumber": 3005,
	    "kind": "not_found",
	    "retry": "never",
	    "status": 404
	  },
	  {
	    "code": "storage_conflict",
	    "description": "Storage state conflict or idempotency collision.",
	    "domain": "storage",
	    "errorNumber": 3006,
	    "kind": "conflict",
	    "retry": "never",
	    "status": 409
	  },
	  {
	    "code": "storage_provider_unavailable",
	    "description": "Upstream object store is unavailable.",
	    "domain": "storage",
	    "errorNumber": 3007,
	    "kind": "unavailable",
	    "retry": "safe",
	    "status": 503
	  },
	  {
	    "code": "storage_provider_authentication_failed",
	    "description": "Upstream object store rejected the resolved credentials.",
	    "domain": "storage",
	    "errorNumber": 3008,
	    "kind": "authentication",
	    "retry": "never",
	    "status": 403
	  },
	  {
	    "code": "storage_persistence_failure",
	    "description": "Storage metadata persistence failed.",
	    "domain": "storage",
	    "errorNumber": 3009,
	    "kind": "internal",
	    "retry": "never",
	    "status": 503
	  },
	  {
	    "code": "storage_internal",
	    "description": "Unexpected storage subsystem failure.",
	    "domain": "storage",
	    "errorNumber": 3010,
	    "kind": "internal",
	    "retry": "never",
	    "status": 500
	  },
	  {
	    "code": "storage_r2_invalid_access_key_id_format",
	    "description": "Cloudflare R2 direct credentials used an invalid S3 access key ID format for the selected endpoint.",
	    "domain": "storage",
	    "errorNumber": 3011,
	    "kind": "validation",
	    "retry": "never",
	    "status": 400
	  },
	  {
	    "code": "storage_upstream_invalid_argument",
	    "description": "The upstream S3-compatible backend rejected the request as caller-correctable.",
	    "domain": "storage",
	    "errorNumber": 3012,
	    "kind": "validation",
	    "retry": "never",
	    "status": 400
	  },
	  {
	    "code": "storage_upstream_access_denied",
	    "description": "The upstream S3-compatible backend rejected the request because the provided credentials lack permission.",
	    "domain": "storage",
	    "errorNumber": 3013,
	    "kind": "authorization",
	    "retry": "never",
	    "status": 403
	  },
	  {
	    "code": "storage_bucket_not_found",
	    "description": "The requested bucket does not exist on the selected storage backend.",
	    "domain": "storage",
	    "errorNumber": 3014,
	    "kind": "not_found",
	    "retry": "never",
	    "status": 404
	  },
	  {
	    "code": "storage_upstream_unavailable",
	    "description": "Athena could not reach or complete the request against the selected storage backend.",
	    "domain": "storage",
	    "errorNumber": 3015,
	    "kind": "unavailable",
	    "retry": "safe",
	    "status": 503
	  },
	  {
	    "code": "storage_list_buckets_failed",
	    "description": "Athena failed while normalizing an upstream bucket-list response.",
	    "domain": "storage",
	    "errorNumber": 3016,
	    "kind": "internal",
	    "retry": "never",
	    "status": 502
	  },
	  {
	    "code": "storage_list_objects_failed",
	    "description": "Athena failed while normalizing an upstream object-list response.",
	    "domain": "storage",
	    "errorNumber": 3017,
	    "kind": "internal",
	    "retry": "never",
	    "status": 502
	  },
	  {
	    "code": "storage_encryption_key_missing",
	    "description": "Storage encryption key is not configured and auto-generation is disabled (ATHENA_STORAGE_SECRET_ENCRYPTION_KEY_AUTO=false); credential operations are unavailable.",
	    "domain": "storage",
	    "errorNumber": 3018,
	    "kind": "not_found",
	    "retry": "never",
	    "status": 503
	  },
	  {
	    "code": "storage_encryption_key_invalid",
	    "description": "Storage encryption key configuration is present but unusable.",
	    "domain": "storage",
	    "errorNumber": 3019,
	    "kind": "internal",
	    "retry": "never",
	    "status": 503
	  },
	  {
	    "code": "storage_credential_decrypt_failed",
	    "description": "Active s3_credentials.secret_key_encrypted could not be decrypted with the configured encryption key. s3_id refers to s3_catalogs.id.",
	    "domain": "storage",
	    "errorNumber": 3020,
	    "kind": "authentication",
	    "retry": "never",
	    "status": 503
	  },
	  {
	    "code": "storage_credential_missing",
	    "description": "No active athena.s3_credentials row exists for the requested s3_catalogs.id (API field s3_id).",
	    "domain": "storage",
	    "errorNumber": 3021,
	    "kind": "authentication",
	    "retry": "never",
	    "status": 503
	  },
	  {
	    "code": "storage_credential_corrupted",
	    "description": "Active credential ciphertext is missing, empty after decrypt, or structurally invalid.",
	    "domain": "storage",
	    "errorNumber": 3022,
	    "kind": "authentication",
	    "retry": "never",
	    "status": 503
	  },
	  {
	    "code": "storage_catalog_not_found",
	    "description": "No athena.s3_catalogs row exists for the requested s3_id (catalog id).",
	    "domain": "storage",
	    "errorNumber": 3023,
	    "kind": "not_found",
	    "retry": "never",
	    "status": 404
	  }
	]);
