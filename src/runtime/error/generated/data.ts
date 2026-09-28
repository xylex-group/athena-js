/* AUTO-GENERATED from contracts/data/errors.json. Do not hand-edit. */
import type { AthenaErrorIR } from "../ir.ts";

export const ATHENA_DATA_ERROR_DESCRIPTORS: readonly AthenaErrorIR<string, "data">[] =
	Object.freeze([
	  {
	    "code": "data_relation_not_found",
	    "description": "The requested table or schema does not exist.",
	    "domain": "data",
	    "errorNumber": 10000,
	    "kind": "not_found",
	    "retry": "never",
	    "status": 404
	  },
	  {
	    "code": "data_schema_not_found",
	    "description": "The requested database schema does not exist.",
	    "domain": "data",
	    "errorNumber": 10001,
	    "kind": "not_found",
	    "retry": "never",
	    "status": 404
	  },
	  {
	    "code": "data_column_not_found",
	    "description": "The requested column does not exist.",
	    "domain": "data",
	    "errorNumber": 10002,
	    "kind": "not_found",
	    "retry": "never",
	    "status": 404
	  },
	  {
	    "code": "data_function_not_found",
	    "description": "The requested database function does not exist.",
	    "domain": "data",
	    "errorNumber": 10003,
	    "kind": "not_found",
	    "retry": "never",
	    "status": 404
	  },
	  {
	    "code": "data_constraint_violation",
	    "description": "A database constraint rejected the request.",
	    "domain": "data",
	    "errorNumber": 10004,
	    "kind": "validation",
	    "retry": "never",
	    "status": 400
	  },
	  {
	    "code": "data_invalid_value",
	    "description": "The request included a value the database rejected.",
	    "domain": "data",
	    "errorNumber": 10005,
	    "kind": "validation",
	    "retry": "never",
	    "status": 400
	  },
	  {
	    "code": "data_conflict",
	    "description": "The request conflicts with existing data.",
	    "domain": "data",
	    "errorNumber": 10006,
	    "kind": "conflict",
	    "retry": "never",
	    "status": 409
	  },
	  {
	    "code": "data_permission_denied",
	    "description": "The database refused the operation.",
	    "domain": "data",
	    "errorNumber": 10007,
	    "kind": "authorization",
	    "retry": "never",
	    "status": 403
	  },
	  {
	    "code": "data_query_cancelled",
	    "description": "The database cancelled the query before it completed.",
	    "domain": "data",
	    "errorNumber": 10008,
	    "kind": "unavailable",
	    "retry": "never",
	    "status": 408
	  },
	  {
	    "code": "data_backend_unavailable",
	    "description": "The database backend is unavailable.",
	    "domain": "data",
	    "errorNumber": 10009,
	    "kind": "unavailable",
	    "retry": "safe",
	    "status": 503
	  },
	  {
	    "code": "data_execution_failed",
	    "description": "The data operation failed.",
	    "domain": "data",
	    "errorNumber": 10010,
	    "kind": "internal",
	    "retry": "never",
	    "status": 500
	  }
	]);
