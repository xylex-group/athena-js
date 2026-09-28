/* AUTO-GENERATED from contracts/auth/errors.json. Do not hand-edit. */
import type { AthenaErrorIR } from "../ir.ts";

export const ATHENA_AUTH_ERROR_DESCRIPTORS: readonly AthenaErrorIR<string, "auth">[] =
	Object.freeze([
	  {
	    "code": "auth_bad_request",
	    "description": "The auth request payload or headers are malformed.",
	    "domain": "auth",
	    "errorNumber": 8000,
	    "kind": "validation",
	    "retry": "never",
	    "status": 400
	  },
	  {
	    "code": "auth_invalid_request",
	    "description": "The auth request is invalid for the target endpoint.",
	    "domain": "auth",
	    "errorNumber": 8001,
	    "kind": "validation",
	    "retry": "never",
	    "status": 400
	  },
	  {
	    "code": "auth_validation",
	    "description": "Auth input failed validation.",
	    "domain": "auth",
	    "errorNumber": 8002,
	    "kind": "validation",
	    "retry": "never",
	    "status": 400
	  },
	  {
	    "code": "auth_invalid_credentials",
	    "description": "The provided credentials are invalid.",
	    "domain": "auth",
	    "errorNumber": 8003,
	    "kind": "authentication",
	    "retry": "never",
	    "status": 401
	  },
	  {
	    "code": "auth_unauthenticated",
	    "description": "Authentication is required for this operation.",
	    "domain": "auth",
	    "errorNumber": 8004,
	    "kind": "validation",
	    "retry": "never",
	    "status": 401
	  },
	  {
	    "code": "auth_session_not_found",
	    "description": "The session was not found or has expired.",
	    "domain": "auth",
	    "errorNumber": 8005,
	    "kind": "not_found",
	    "retry": "never",
	    "status": 401
	  },
	  {
	    "code": "auth_forbidden",
	    "description": "The authenticated principal is forbidden from this operation.",
	    "domain": "auth",
	    "errorNumber": 8006,
	    "kind": "authorization",
	    "retry": "never",
	    "status": 403
	  },
	  {
	    "code": "auth_insufficient_permissions",
	    "description": "The authenticated principal lacks the required permissions.",
	    "domain": "auth",
	    "errorNumber": 8007,
	    "kind": "validation",
	    "retry": "never",
	    "status": 403
	  },
	  {
	    "code": "auth_user_not_found",
	    "description": "The requested user was not found.",
	    "domain": "auth",
	    "errorNumber": 8008,
	    "kind": "not_found",
	    "retry": "never",
	    "status": 404
	  },
	  {
	    "code": "auth_not_found",
	    "description": "The requested auth resource was not found.",
	    "domain": "auth",
	    "errorNumber": 8009,
	    "kind": "not_found",
	    "retry": "never",
	    "status": 404
	  },
	  {
	    "code": "auth_conflict",
	    "description": "The auth operation conflicts with existing state.",
	    "domain": "auth",
	    "errorNumber": 8010,
	    "kind": "conflict",
	    "retry": "never",
	    "status": 409
	  },
	  {
	    "code": "auth_rate_limited",
	    "description": "Too many auth requests; retry later.",
	    "domain": "auth",
	    "errorNumber": 8011,
	    "kind": "rate_limited",
	    "retry": "safe",
	    "status": 429
	  },
	  {
	    "code": "auth_not_implemented",
	    "description": "The requested auth capability is not implemented.",
	    "domain": "auth",
	    "errorNumber": 8012,
	    "kind": "internal",
	    "retry": "never",
	    "status": 501
	  },
	  {
	    "code": "auth_config",
	    "description": "Auth service configuration is invalid or incomplete.",
	    "domain": "auth",
	    "errorNumber": 8013,
	    "kind": "internal",
	    "retry": "never",
	    "status": 500
	  },
	  {
	    "code": "auth_database",
	    "description": "Auth persistence failed unexpectedly.",
	    "domain": "auth",
	    "errorNumber": 8014,
	    "kind": "internal",
	    "retry": "never",
	    "status": 500
	  },
	  {
	    "code": "auth_internal",
	    "description": "An unexpected auth internal error occurred.",
	    "domain": "auth",
	    "errorNumber": 8015,
	    "kind": "internal",
	    "retry": "never",
	    "status": 500
	  },
	  {
	    "code": "auth_avatar_invalid_payload",
	    "description": "The avatar image payload is invalid.",
	    "domain": "auth",
	    "errorNumber": 8016,
	    "kind": "validation",
	    "retry": "never",
	    "status": 400
	  },
	  {
	    "code": "auth_avatar_unsupported_format",
	    "description": "The avatar image must be PNG, JPEG, or WebP.",
	    "domain": "auth",
	    "errorNumber": 8017,
	    "kind": "unsupported",
	    "retry": "never",
	    "status": 400
	  },
	  {
	    "code": "auth_avatar_too_large",
	    "description": "The avatar image exceeds the maximum allowed size.",
	    "domain": "auth",
	    "errorNumber": 8018,
	    "kind": "validation",
	    "retry": "never",
	    "status": 413
	  },
	  {
	    "code": "auth_avatar_storage_unavailable",
	    "description": "Avatar object storage is not configured.",
	    "domain": "auth",
	    "errorNumber": 8019,
	    "kind": "unavailable",
	    "retry": "safe",
	    "status": 503
	  },
	  {
	    "code": "auth_avatar_upload_failed",
	    "description": "Avatar upload to object storage failed.",
	    "domain": "auth",
	    "errorNumber": 8020,
	    "kind": "internal",
	    "retry": "never",
	    "status": 502
	  },
	  {
	    "code": "auth_avatar_url_generation_failed",
	    "description": "Unable to generate an avatar object URL.",
	    "domain": "auth",
	    "errorNumber": 8021,
	    "kind": "internal",
	    "retry": "never",
	    "status": 500
	  },
	  {
	    "code": "auth_avatar_signing_failed",
	    "description": "Unable to sign an avatar object URL.",
	    "domain": "auth",
	    "errorNumber": 8022,
	    "kind": "internal",
	    "retry": "never",
	    "status": 500
	  },
	  {
	    "code": "auth_bridge_exchange_invalid",
	    "description": "The one-time auth bridge code is invalid, expired, already consumed, or bound to a different destination.",
	    "domain": "auth",
	    "errorNumber": 8023,
	    "kind": "validation",
	    "retry": "never",
	    "status": 401
	  },
	  {
	    "code": "auth_athena_audit_previous_required",
	    "description": "The Auth audit Event IR requires a previous snapshot and none was captured.",
	    "domain": "auth",
	    "errorNumber": 8024,
	    "kind": "internal",
	    "retry": "never",
	    "status": 500
	  },
	  {
	    "code": "auth_athena_audit_result_required",
	    "description": "The Auth audit Event IR requires a result snapshot and none was produced.",
	    "domain": "auth",
	    "errorNumber": 8025,
	    "kind": "internal",
	    "retry": "never",
	    "status": 500
	  },
	  {
	    "code": "auth_athena_audit_subject_required",
	    "description": "The Auth audit Event IR could not resolve a subject id and type.",
	    "domain": "auth",
	    "errorNumber": 8026,
	    "kind": "internal",
	    "retry": "never",
	    "status": 500
	  },
	  {
	    "code": "auth_athena_audit_subject_type_mismatch",
	    "description": "The resolved audit subject type does not match the catalog subjectType.",
	    "domain": "auth",
	    "errorNumber": 8027,
	    "kind": "internal",
	    "retry": "never",
	    "status": 500
	  },
	  {
	    "code": "auth_athena_audit_organization_unresolved",
	    "description": "An org-aware Auth event could not resolve organization_id from the Event IR.",
	    "domain": "auth",
	    "errorNumber": 8028,
	    "kind": "internal",
	    "retry": "never",
	    "status": 500
	  },
	  {
	    "code": "auth_athena_audit_invalid_result",
	    "description": "The Auth audit result snapshot failed the resource vs receipt policy.",
	    "domain": "auth",
	    "errorNumber": 8029,
	    "kind": "internal",
	    "retry": "never",
	    "status": 500
	  },
	  {
	    "code": "auth_authorization_role_protected",
	    "description": "Built-in protected roles cannot be renamed, deleted, or have their rights replaced.",
	    "domain": "auth",
	    "errorNumber": 8030,
	    "kind": "authorization",
	    "retry": "never",
	    "status": 403
	  },
	  {
	    "code": "auth_authorization_role_version_conflict",
	    "description": "The role was modified concurrently; reload and retry with the current version.",
	    "domain": "auth",
	    "errorNumber": 8031,
	    "kind": "authorization",
	    "retry": "never",
	    "status": 409
	  },
	  {
	    "code": "auth_authorization_role_has_assignments",
	    "description": "The role still has assignments; reassign them before deleting.",
	    "domain": "auth",
	    "errorNumber": 8032,
	    "kind": "authorization",
	    "retry": "never",
	    "status": 409
	  },
	  {
	    "code": "auth_authorization_right_unknown",
	    "description": "The requested right is not in the authorization catalog.",
	    "domain": "auth",
	    "errorNumber": 8033,
	    "kind": "authorization",
	    "retry": "never",
	    "status": 400
	  },
	  {
	    "code": "auth_authorization_right_not_assignable",
	    "description": "The requested right is not assignable to roles.",
	    "domain": "auth",
	    "errorNumber": 8034,
	    "kind": "authorization",
	    "retry": "never",
	    "status": 400
	  },
	  {
	    "code": "auth_authorization_right_scope_mismatch",
	    "description": "The right's scope is not allowed on this role.",
	    "domain": "auth",
	    "errorNumber": 8035,
	    "kind": "authorization",
	    "retry": "never",
	    "status": 400
	  },
	  {
	    "code": "auth_authorization_role_not_found",
	    "description": "The authorization role was not found in the current command scope.",
	    "domain": "auth",
	    "errorNumber": 8036,
	    "kind": "authorization",
	    "retry": "never",
	    "status": 404
	  },
	  {
	    "code": "auth_authorization_reassignment_invalid",
	    "description": "The replacement role is missing, out of scope, or not assignable.",
	    "domain": "auth",
	    "errorNumber": 8037,
	    "kind": "authorization",
	    "retry": "never",
	    "status": 400
	  }
	]);
