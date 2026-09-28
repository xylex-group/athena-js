/* AUTO-GENERATED from contracts/internal/errors.json. Do not hand-edit. */
import type { AthenaErrorIR } from "../ir.ts";

export const ATHENA_INTERNAL_ERROR_DESCRIPTORS: readonly AthenaErrorIR<string, "internal">[] =
	Object.freeze([
	  {
	    "code": "unique_violation",
	    "description": "A uniqueness constraint rejected the request.",
	    "domain": "internal",
	    "errorNumber": 1000,
	    "kind": "conflict",
	    "retry": "never",
	    "status": 409
	  },
	  {
	    "code": "foreign_key_violation",
	    "description": "A foreign-key constraint rejected the request.",
	    "domain": "internal",
	    "errorNumber": 1001,
	    "kind": "validation",
	    "retry": "never",
	    "status": 409
	  },
	  {
	    "code": "not_null_violation",
	    "description": "A required database field was missing.",
	    "domain": "internal",
	    "errorNumber": 1002,
	    "kind": "validation",
	    "retry": "never",
	    "status": 400
	  },
	  {
	    "code": "check_constraint_violation",
	    "description": "A database check constraint rejected the request.",
	    "domain": "internal",
	    "errorNumber": 1003,
	    "kind": "validation",
	    "retry": "never",
	    "status": 400
	  },
	  {
	    "code": "invalid_text_encoding",
	    "description": "The request included invalid text encoding.",
	    "domain": "internal",
	    "errorNumber": 1004,
	    "kind": "validation",
	    "retry": "never",
	    "status": 400
	  },
	  {
	    "code": "undefined_column",
	    "description": "The request referenced a column that does not exist.",
	    "domain": "internal",
	    "errorNumber": 1005,
	    "kind": "validation",
	    "retry": "never",
	    "status": 400
	  },
	  {
	    "code": "type_operator_mismatch",
	    "description": "The request used incompatible operand types.",
	    "domain": "internal",
	    "errorNumber": 1006,
	    "kind": "validation",
	    "retry": "never",
	    "status": 422
	  },
	  {
	    "code": "text_uuid_operator_mismatch",
	    "description": "The request compared text and UUID values without compatible coercion.",
	    "domain": "internal",
	    "errorNumber": 1007,
	    "kind": "validation",
	    "retry": "never",
	    "status": 422
	  },
	  {
	    "code": "syntax_error",
	    "description": "The SQL or query shape is invalid.",
	    "domain": "internal",
	    "errorNumber": 1008,
	    "kind": "validation",
	    "retry": "never",
	    "status": 400
	  },
	  {
	    "code": "insufficient_privilege",
	    "description": "The caller lacks database privileges.",
	    "domain": "internal",
	    "errorNumber": 1009,
	    "kind": "authorization",
	    "retry": "never",
	    "status": 403
	  },
	  {
	    "code": "connection_error",
	    "description": "Athena could not reach the database backend.",
	    "domain": "internal",
	    "errorNumber": 1010,
	    "kind": "unavailable",
	    "retry": "safe",
	    "status": 503
	  },
	  {
	    "code": "pool_timeout",
	    "description": "Athena timed out waiting for a database connection.",
	    "domain": "internal",
	    "errorNumber": 1011,
	    "kind": "unavailable",
	    "retry": "safe",
	    "status": 503
	  },
	  {
	    "code": "pool_closed",
	    "description": "The database connection pool is closed.",
	    "domain": "internal",
	    "errorNumber": 1012,
	    "kind": "internal",
	    "retry": "never",
	    "status": 503
	  },
	  {
	    "code": "worker_crashed",
	    "description": "A database worker crashed during execution.",
	    "domain": "internal",
	    "errorNumber": 1013,
	    "kind": "internal",
	    "retry": "never",
	    "status": 500
	  },
	  {
	    "code": "io_error",
	    "description": "A database network or I/O failure occurred.",
	    "domain": "internal",
	    "errorNumber": 1014,
	    "kind": "internal",
	    "retry": "never",
	    "status": 503
	  },
	  {
	    "code": "tls_error",
	    "description": "A secure database connection could not be established.",
	    "domain": "internal",
	    "errorNumber": 1015,
	    "kind": "internal",
	    "retry": "never",
	    "status": 503
	  },
	  {
	    "code": "column_not_found",
	    "description": "Athena could not find a query result column it expected.",
	    "domain": "internal",
	    "errorNumber": 1016,
	    "kind": "not_found",
	    "retry": "never",
	    "status": 500
	  },
	  {
	    "code": "column_index_out_of_bounds",
	    "description": "Athena attempted to read a query result column beyond the available range.",
	    "domain": "internal",
	    "errorNumber": 1017,
	    "kind": "internal",
	    "retry": "never",
	    "status": 500
	  },
	  {
	    "code": "type_not_found",
	    "description": "Athena could not resolve a database type.",
	    "domain": "internal",
	    "errorNumber": 1018,
	    "kind": "not_found",
	    "retry": "never",
	    "status": 500
	  },
	  {
	    "code": "column_decode_error",
	    "description": "Athena failed to decode a result column.",
	    "domain": "internal",
	    "errorNumber": 1019,
	    "kind": "internal",
	    "retry": "never",
	    "status": 500
	  },
	  {
	    "code": "row_not_found",
	    "description": "The requested row does not exist.",
	    "domain": "internal",
	    "errorNumber": 1020,
	    "kind": "not_found",
	    "retry": "never",
	    "status": 404
	  },
	  {
	    "code": "migration_error",
	    "description": "A database migration operation failed.",
	    "domain": "internal",
	    "errorNumber": 1021,
	    "kind": "internal",
	    "retry": "never",
	    "status": 500
	  },
	  {
	    "code": "configuration_error",
	    "description": "Athena database configuration is invalid.",
	    "domain": "internal",
	    "errorNumber": 1022,
	    "kind": "internal",
	    "retry": "never",
	    "status": 500
	  },
	  {
	    "code": "database_error",
	    "description": "Athena hit an unclassified database error.",
	    "domain": "internal",
	    "errorNumber": 1023,
	    "kind": "internal",
	    "retry": "never",
	    "status": 500
	  },
	  {
	    "code": "data_exception",
	    "description": "The database rejected caller-provided data.",
	    "domain": "internal",
	    "errorNumber": 1024,
	    "kind": "validation",
	    "retry": "never",
	    "status": 400
	  },
	  {
	    "code": "query_syntax",
	    "description": "The query is invalid for the database backend.",
	    "domain": "internal",
	    "errorNumber": 1025,
	    "kind": "validation",
	    "retry": "never",
	    "status": 400
	  },
	  {
	    "code": "db_error",
	    "description": "The database returned an unclassified server error.",
	    "domain": "internal",
	    "errorNumber": 1026,
	    "kind": "internal",
	    "retry": "never",
	    "status": 500
	  },
	  {
	    "code": "postgres_driver_error",
	    "description": "The PostgreSQL driver failed before completion.",
	    "domain": "internal",
	    "errorNumber": 1027,
	    "kind": "internal",
	    "retry": "never",
	    "status": 502
	  }
	]);
