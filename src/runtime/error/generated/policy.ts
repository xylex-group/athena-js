/* AUTO-GENERATED from contracts/policy/errors.json. Do not hand-edit. */
import type { AthenaErrorIR } from "../ir.ts";

export const ATHENA_POLICY_ERROR_DESCRIPTORS: readonly AthenaErrorIR<string, "policy">[] =
	Object.freeze([
	  {
	    "code": "policy_denied",
	    "description": "The policy engine denied the requested operation.",
	    "domain": "policy",
	    "errorNumber": 7000,
	    "kind": "validation",
	    "retry": "never",
	    "status": 403
	  },
	  {
	    "code": "policy_field_denied",
	    "description": "The policy engine denied access to one or more fields.",
	    "domain": "policy",
	    "errorNumber": 7001,
	    "kind": "validation",
	    "retry": "never",
	    "status": 403
	  },
	  {
	    "code": "policy_write_conflict",
	    "description": "The write conflicts with policy visibility or check predicates.",
	    "domain": "policy",
	    "errorNumber": 7002,
	    "kind": "conflict",
	    "retry": "never",
	    "status": 409
	  },
	  {
	    "code": "policy_subject_required",
	    "description": "A trusted policy subject is required for this operation.",
	    "domain": "policy",
	    "errorNumber": 7003,
	    "kind": "validation",
	    "retry": "never",
	    "status": 401
	  },
	  {
	    "code": "policy_subject_attribute_missing",
	    "description": "A required trusted subject attribute is missing.",
	    "domain": "policy",
	    "errorNumber": 7004,
	    "kind": "not_found",
	    "retry": "never",
	    "status": 401
	  },
	  {
	    "code": "policy_resource_unmanaged",
	    "description": "The target resource is not managed by the active policy set.",
	    "domain": "policy",
	    "errorNumber": 7005,
	    "kind": "validation",
	    "retry": "never",
	    "status": 403
	  },
	  {
	    "code": "policy_invalid",
	    "description": "The policy definition or IR document is invalid.",
	    "domain": "policy",
	    "errorNumber": 7006,
	    "kind": "validation",
	    "retry": "never",
	    "status": 400
	  },
	  {
	    "code": "policy_compilation_failed",
	    "description": "Athena failed to compile the policy set into a runtime artifact.",
	    "domain": "policy",
	    "errorNumber": 7007,
	    "kind": "internal",
	    "retry": "never",
	    "status": 500
	  },
	  {
	    "code": "policy_capability_unsupported",
	    "description": "The backend capability profile cannot enforce the required policy predicate.",
	    "domain": "policy",
	    "errorNumber": 7008,
	    "kind": "unsupported",
	    "retry": "never",
	    "status": 422
	  },
	  {
	    "code": "policy_raw_sql_denied",
	    "description": "Raw SQL is denied while policy enforcement is active.",
	    "domain": "policy",
	    "errorNumber": 7009,
	    "kind": "validation",
	    "retry": "never",
	    "status": 403
	  },
	  {
	    "code": "policy_rpc_denied",
	    "description": "RPC execution is denied while policy enforcement is active.",
	    "domain": "policy",
	    "errorNumber": 7010,
	    "kind": "validation",
	    "retry": "never",
	    "status": 403
	  },
	  {
	    "code": "policy_context_invalid",
	    "description": "The policy evaluation context is invalid.",
	    "domain": "policy",
	    "errorNumber": 7011,
	    "kind": "validation",
	    "retry": "never",
	    "status": 400
	  },
	  {
	    "code": "policy_version_mismatch",
	    "description": "The bound policy version does not match the compiled artifact.",
	    "domain": "policy",
	    "errorNumber": 7012,
	    "kind": "validation",
	    "retry": "never",
	    "status": 409
	  },
	  {
	    "code": "policy_not_found",
	    "description": "The requested policy was not found.",
	    "domain": "policy",
	    "errorNumber": 7013,
	    "kind": "not_found",
	    "retry": "never",
	    "status": 404
	  },
	  {
	    "code": "policy_set_not_found",
	    "description": "The requested policy set was not found.",
	    "domain": "policy",
	    "errorNumber": 7014,
	    "kind": "not_found",
	    "retry": "never",
	    "status": 404
	  },
	  {
	    "code": "policy_evaluation_failed",
	    "description": "Policy evaluation failed unexpectedly.",
	    "domain": "policy",
	    "errorNumber": 7015,
	    "kind": "internal",
	    "retry": "never",
	    "status": 500
	  },
	  {
	    "code": "policy_enforcement_failed",
	    "description": "Policy enforcement failed unexpectedly.",
	    "domain": "policy",
	    "errorNumber": 7016,
	    "kind": "internal",
	    "retry": "never",
	    "status": 500
	  },
	  {
	    "code": "policy_binding_conflict",
	    "description": "The policy binding conflicts with an existing binding.",
	    "domain": "policy",
	    "errorNumber": 7017,
	    "kind": "conflict",
	    "retry": "never",
	    "status": 409
	  },
	  {
	    "code": "policy_import_unsupported",
	    "description": "The imported policy construct is unsupported.",
	    "domain": "policy",
	    "errorNumber": 7018,
	    "kind": "unsupported",
	    "retry": "never",
	    "status": 422
	  },
	  {
	    "code": "policy_import_function_unresolved",
	    "description": "An imported policy function could not be resolved.",
	    "domain": "policy",
	    "errorNumber": 7019,
	    "kind": "validation",
	    "retry": "never",
	    "status": 422
	  },
	  {
	    "code": "policy_schema_drift",
	    "description": "The live schema drifted from the schema fingerprint used to compile policies.",
	    "domain": "policy",
	    "errorNumber": 7020,
	    "kind": "validation",
	    "retry": "never",
	    "status": 409
	  }
	]);
