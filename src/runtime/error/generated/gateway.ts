/* AUTO-GENERATED from contracts/gateway/errors.json. Do not hand-edit. */
import type { AthenaErrorIR } from "../ir.ts";

export const ATHENA_GATEWAY_ERROR_DESCRIPTORS: readonly AthenaErrorIR<string, "gateway">[] =
	Object.freeze([
	  {
	    "code": "gateway_validation_failed",
	    "description": "Legacy generic validation fallback for older gateway paths.",
	    "domain": "gateway",
	    "errorNumber": 2000,
	    "kind": "validation",
	    "retry": "never",
	    "status": 400
	  },
	  {
	    "code": "gateway_internal_error",
	    "description": "Legacy generic internal fallback for older gateway paths.",
	    "domain": "gateway",
	    "errorNumber": 2001,
	    "kind": "internal",
	    "retry": "never",
	    "status": 500
	  },
	  {
	    "code": "gateway_service_unavailable",
	    "description": "Legacy generic availability fallback for older gateway paths.",
	    "domain": "gateway",
	    "errorNumber": 2002,
	    "kind": "unavailable",
	    "retry": "safe",
	    "status": 503
	  },
	  {
	    "code": "gateway_missing_client_header",
	    "description": "The request omitted both X-Athena-Client and direct PostgreSQL routing headers.",
	    "domain": "gateway",
	    "errorNumber": 2003,
	    "kind": "not_found",
	    "retry": "never",
	    "status": 400
	  },
	  {
	    "code": "gateway_invalid_client",
	    "description": "The provided Athena client name does not resolve to a configured client.",
	    "domain": "gateway",
	    "errorNumber": 2004,
	    "kind": "validation",
	    "retry": "never",
	    "status": 400
	  },
	  {
	    "code": "gateway_client_inactive",
	    "description": "The resolved Athena client exists but is inactive.",
	    "domain": "gateway",
	    "errorNumber": 2005,
	    "kind": "validation",
	    "retry": "never",
	    "status": 400
	  },
	  {
	    "code": "gateway_client_frozen",
	    "description": "The resolved Athena client exists but is frozen.",
	    "domain": "gateway",
	    "errorNumber": 2006,
	    "kind": "validation",
	    "retry": "never",
	    "status": 400
	  },
	  {
	    "code": "gateway_invalid_client_metadata",
	    "description": "Athena client metadata is invalid for the requested operation.",
	    "domain": "gateway",
	    "errorNumber": 2007,
	    "kind": "validation",
	    "retry": "never",
	    "status": 400
	  },
	  {
	    "code": "gateway_client_lookup_failed",
	    "description": "Athena could not resolve the requested client because the lookup backend failed.",
	    "domain": "gateway",
	    "errorNumber": 2008,
	    "kind": "internal",
	    "retry": "never",
	    "status": 503
	  },
	  {
	    "code": "gateway_client_catalog_unavailable",
	    "description": "Athena could not read catalog state needed to resolve the requested client.",
	    "domain": "gateway",
	    "errorNumber": 2009,
	    "kind": "unavailable",
	    "retry": "safe",
	    "status": 503
	  },
	  {
	    "code": "gateway_missing_request_body",
	    "description": "The request body is required for this gateway operation.",
	    "domain": "gateway",
	    "errorNumber": 2010,
	    "kind": "not_found",
	    "retry": "never",
	    "status": 400
	  },
	  {
	    "code": "gateway_missing_view_parameter",
	    "description": "The legacy GET /data compatibility route requires the view parameter.",
	    "domain": "gateway",
	    "errorNumber": 2011,
	    "kind": "not_found",
	    "retry": "never",
	    "status": 400
	  },
	  {
	    "code": "gateway_missing_eq_column_parameter",
	    "description": "The legacy GET /data compatibility route requires the eq_column parameter.",
	    "domain": "gateway",
	    "errorNumber": 2012,
	    "kind": "not_found",
	    "retry": "never",
	    "status": 400
	  },
	  {
	    "code": "gateway_missing_eq_value_parameter",
	    "description": "The legacy GET /data compatibility route requires the eq_value parameter.",
	    "domain": "gateway",
	    "errorNumber": 2013,
	    "kind": "not_found",
	    "retry": "never",
	    "status": 400
	  },
	  {
	    "code": "gateway_missing_table_name",
	    "description": "The request did not include a usable table_name selector.",
	    "domain": "gateway",
	    "errorNumber": 2014,
	    "kind": "not_found",
	    "retry": "never",
	    "status": 400
	  },
	  {
	    "code": "gateway_missing_resource_id",
	    "description": "The gateway delete request did not include a resource_id.",
	    "domain": "gateway",
	    "errorNumber": 2015,
	    "kind": "not_found",
	    "retry": "never",
	    "status": 400
	  },
	  {
	    "code": "gateway_missing_update_payload",
	    "description": "The gateway update request did not include a valid update payload.",
	    "domain": "gateway",
	    "errorNumber": 2016,
	    "kind": "not_found",
	    "retry": "never",
	    "status": 400
	  },
	  {
	    "code": "gateway_missing_conditions",
	    "description": "The gateway update request did not include any conditions.",
	    "domain": "gateway",
	    "errorNumber": 2017,
	    "kind": "not_found",
	    "retry": "never",
	    "status": 400
	  },
	  {
	    "code": "gateway_missing_organization_header",
	    "description": "Legacy error code retained for API stability. X-Organization-Id is no longer accepted; organization scope comes from Athena Auth context.",
	    "domain": "gateway",
	    "errorNumber": 2018,
	    "kind": "not_found",
	    "retry": "never",
	    "status": 400
	  },
	  {
	    "code": "gateway_invalid_insert_payload",
	    "description": "The insert request body was missing canonical fields or contained an invalid target selector.",
	    "domain": "gateway",
	    "errorNumber": 2019,
	    "kind": "validation",
	    "retry": "never",
	    "status": 400
	  },
	  {
	    "code": "gateway_invalid_delete_payload",
	    "description": "The delete request body failed Athena delete-side validation.",
	    "domain": "gateway",
	    "errorNumber": 2020,
	    "kind": "validation",
	    "retry": "never",
	    "status": 400
	  },
	  {
	    "code": "gateway_invalid_fetch_condition",
	    "description": "The fetch request contained an invalid compatibility condition.",
	    "domain": "gateway",
	    "errorNumber": 2021,
	    "kind": "validation",
	    "retry": "never",
	    "status": 400
	  },
	  {
	    "code": "gateway_invalid_condition_value",
	    "description": "A request condition value failed Athena validation or coercion.",
	    "domain": "gateway",
	    "errorNumber": 2022,
	    "kind": "validation",
	    "retry": "never",
	    "status": 400
	  },
	  {
	    "code": "gateway_invalid_structured_select_request",
	    "description": "The structured select request body does not satisfy Athena's public fetch contract.",
	    "domain": "gateway",
	    "errorNumber": 2023,
	    "kind": "validation",
	    "retry": "never",
	    "status": 400
	  },
	  {
	    "code": "gateway_invalid_schema_table_selector",
	    "description": "The combination of schema_name and table_name is invalid or ambiguous.",
	    "domain": "gateway",
	    "errorNumber": 2024,
	    "kind": "validation",
	    "retry": "never",
	    "status": 400
	  },
	  {
	    "code": "gateway_invalid_schema_name",
	    "description": "The provided schema_name is not a valid Athena schema selector.",
	    "domain": "gateway",
	    "errorNumber": 2025,
	    "kind": "validation",
	    "retry": "never",
	    "status": 400
	  },
	  {
	    "code": "gateway_invalid_post_processing_configuration",
	    "description": "The fetch request asked Athena to apply an invalid post-processing configuration.",
	    "domain": "gateway",
	    "errorNumber": 2026,
	    "kind": "validation",
	    "retry": "never",
	    "status": 400
	  },
	  {
	    "code": "gateway_invalid_query_payload",
	    "description": "The /gateway/query JSON body does not match the canonical request shape.",
	    "domain": "gateway",
	    "errorNumber": 2027,
	    "kind": "validation",
	    "retry": "never",
	    "status": 400
	  },
	  {
	    "code": "gateway_malformed_json_payload",
	    "description": "The request body could not be parsed as valid JSON.",
	    "domain": "gateway",
	    "errorNumber": 2028,
	    "kind": "validation",
	    "retry": "never",
	    "status": 400
	  },
	  {
	    "code": "gateway_invalid_relation_select_compatibility_query",
	    "description": "The SQL relation-select compatibility query could not be rewritten into a valid Athena fetch plan.",
	    "domain": "gateway",
	    "errorNumber": 2029,
	    "kind": "validation",
	    "retry": "never",
	    "status": 400
	  },
	  {
	    "code": "gateway_empty_query",
	    "description": "The provided SQL query was empty after normalization.",
	    "domain": "gateway",
	    "errorNumber": 2030,
	    "kind": "validation",
	    "retry": "never",
	    "status": 400
	  },
	  {
	    "code": "gateway_unsupported_schema_name",
	    "description": "The requested backend does not support schema_name for this operation.",
	    "domain": "gateway",
	    "errorNumber": 2031,
	    "kind": "unsupported",
	    "retry": "never",
	    "status": 400
	  },
	  {
	    "code": "gateway_unsupported_fetch_shape",
	    "description": "The request used a fetch shape that Athena cannot execute on the resolved backend.",
	    "domain": "gateway",
	    "errorNumber": 2032,
	    "kind": "unsupported",
	    "retry": "never",
	    "status": 400
	  },
	  {
	    "code": "gateway_deferred_query_not_supported",
	    "description": "The resolved backend does not support deferred gateway query execution.",
	    "domain": "gateway",
	    "errorNumber": 2033,
	    "kind": "validation",
	    "retry": "never",
	    "status": 400
	  },
	  {
	    "code": "gateway_deferred_queue_unavailable",
	    "description": "Athena could not enqueue the request into the deferred queue.",
	    "domain": "gateway",
	    "errorNumber": 2034,
	    "kind": "unavailable",
	    "retry": "safe",
	    "status": 503
	  },
	  {
	    "code": "gateway_outbound_request_rate_limited",
	    "description": "Athena throttled an outbound backend request before execution completed.",
	    "domain": "gateway",
	    "errorNumber": 2035,
	    "kind": "rate_limited",
	    "retry": "safe",
	    "status": 503
	  },
	  {
	    "code": "gateway_backend_temporarily_unavailable",
	    "description": "The resolved backend is temporarily unavailable and should be retried later.",
	    "domain": "gateway",
	    "errorNumber": 2036,
	    "kind": "unavailable",
	    "retry": "safe",
	    "status": 503
	  },
	  {
	    "code": "gateway_backend_unavailable",
	    "description": "A backend dependency needed by the gateway route is unavailable.",
	    "domain": "gateway",
	    "errorNumber": 2037,
	    "kind": "unavailable",
	    "retry": "safe",
	    "status": 503
	  },
	  {
	    "code": "gateway_invalid_route_target",
	    "description": "The configured route target URL is invalid for Athena proxying.",
	    "domain": "gateway",
	    "errorNumber": 2038,
	    "kind": "internal",
	    "retry": "never",
	    "status": 503
	  },
	  {
	    "code": "gateway_route_target_loop_detected",
	    "description": "Athena rejected a proxy loop back into another route target hop.",
	    "domain": "gateway",
	    "errorNumber": 2039,
	    "kind": "validation",
	    "retry": "never",
	    "status": 400
	  },
	  {
	    "code": "gateway_route_target_unavailable",
	    "description": "Athena could not reach the configured upstream route target.",
	    "domain": "gateway",
	    "errorNumber": 2040,
	    "kind": "unavailable",
	    "retry": "safe",
	    "status": 503
	  },
	  {
	    "code": "gateway_route_target_response_unavailable",
	    "description": "Athena reached the route target but could not read the upstream response body.",
	    "domain": "gateway",
	    "errorNumber": 2041,
	    "kind": "unavailable",
	    "retry": "safe",
	    "status": 503
	  },
	  {
	    "code": "gateway_fetch_delegation_failed",
	    "description": "Athena failed while delegating a legacy GET /data request through the fetch path.",
	    "domain": "gateway",
	    "errorNumber": 2042,
	    "kind": "internal",
	    "retry": "never",
	    "status": 500
	  },
	  {
	    "code": "gateway_fetch_response_processing_failed",
	    "description": "Athena failed while post-processing or normalizing fetch results.",
	    "domain": "gateway",
	    "errorNumber": 2043,
	    "kind": "internal",
	    "retry": "never",
	    "status": 500
	  },
	  {
	    "code": "gateway_fetch_data_failed",
	    "description": "Athena failed while building the final gateway fetch response.",
	    "domain": "gateway",
	    "errorNumber": 2044,
	    "kind": "internal",
	    "retry": "never",
	    "status": 500
	  },
	  {
	    "code": "gateway_delete_execution_failed",
	    "description": "Athena failed while executing the gateway delete operation.",
	    "domain": "gateway",
	    "errorNumber": 2045,
	    "kind": "internal",
	    "retry": "never",
	    "status": 500
	  },
	  {
	    "code": "gateway_query_sql_execution_failed",
	    "description": "Athena rejected SQL statement execution for a caller-correctable reason.",
	    "domain": "gateway",
	    "errorNumber": 2046,
	    "kind": "validation",
	    "retry": "never",
	    "status": 400
	  },
	  {
	    "code": "gateway_query_backend_unavailable",
	    "description": "Athena could not execute the query because the resolved backend was unavailable.",
	    "domain": "gateway",
	    "errorNumber": 2047,
	    "kind": "unavailable",
	    "retry": "safe",
	    "status": 503
	  },
	  {
	    "code": "gateway_query_execution_failed",
	    "description": "Athena failed while executing the query after validation succeeded.",
	    "domain": "gateway",
	    "errorNumber": 2048,
	    "kind": "internal",
	    "retry": "never",
	    "status": 500
	  },
	  {
	    "code": "gateway_d1_backend_unavailable",
	    "description": "Athena could not reach the Cloudflare D1 backend.",
	    "domain": "gateway",
	    "errorNumber": 2049,
	    "kind": "unavailable",
	    "retry": "safe",
	    "status": 503
	  },
	  {
	    "code": "gateway_scylla_backend_unavailable",
	    "description": "Athena could not reach the Scylla backend.",
	    "domain": "gateway",
	    "errorNumber": 2050,
	    "kind": "unavailable",
	    "retry": "safe",
	    "status": 503
	  },
	  {
	    "code": "gateway_insert_window_response_channel_dropped",
	    "description": "The insert window worker failed to return a response to the HTTP handler.",
	    "domain": "gateway",
	    "errorNumber": 2051,
	    "kind": "internal",
	    "retry": "never",
	    "status": 500
	  },
	  {
	    "code": "gateway_supabase_client_resolution_failed",
	    "description": "Athena could not resolve a legacy Supabase client for the request.",
	    "domain": "gateway",
	    "errorNumber": 2052,
	    "kind": "validation",
	    "retry": "never",
	    "status": 400
	  },
	  {
	    "code": "gateway_invalid_delete_resource_id_column",
	    "description": "The explicit delete resource_id column alias is invalid for the resolved backend.",
	    "domain": "gateway",
	    "errorNumber": 2053,
	    "kind": "validation",
	    "retry": "never",
	    "status": 400
	  }
	]);
