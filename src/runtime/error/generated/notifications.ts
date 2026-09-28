/* AUTO-GENERATED from contracts/notifications/errors.json. Do not hand-edit. */
import type { AthenaErrorIR } from "../ir.ts";

export const ATHENA_NOTIFICATIONS_ERROR_DESCRIPTORS: readonly AthenaErrorIR<string, "notifications">[] =
	Object.freeze([
	  {
	    "code": "notifications_athena_unauthenticated",
	    "description": "A signed-in user is required for this notifications operation.",
	    "domain": "notifications",
	    "errorNumber": 9000,
	    "kind": "validation",
	    "retry": "never",
	    "status": 401
	  },
	  {
	    "code": "notifications_athena_topic_unknown",
	    "description": "The notification topic is not in the Athena catalog.",
	    "domain": "notifications",
	    "errorNumber": 9001,
	    "kind": "validation",
	    "retry": "never",
	    "status": 400
	  },
	  {
	    "code": "notifications_athena_channel_unknown",
	    "description": "The notification channel is not in the Athena catalog.",
	    "domain": "notifications",
	    "errorNumber": 9002,
	    "kind": "validation",
	    "retry": "never",
	    "status": 400
	  },
	  {
	    "code": "notifications_athena_digest_invalid",
	    "description": "Notification digest must be null, daily, or weekly.",
	    "domain": "notifications",
	    "errorNumber": 9003,
	    "kind": "validation",
	    "retry": "never",
	    "status": 400
	  },
	  {
	    "code": "notifications_athena_scope_invalid",
	    "description": "Notification organization scope is empty or invalid.",
	    "domain": "notifications",
	    "errorNumber": 9004,
	    "kind": "validation",
	    "retry": "never",
	    "status": 400
	  },
	  {
	    "code": "notifications_athena_event_not_found",
	    "description": "The notification event was not found.",
	    "domain": "notifications",
	    "errorNumber": 9005,
	    "kind": "not_found",
	    "retry": "never",
	    "status": 404
	  },
	  {
	    "code": "notifications_athena_unavailable",
	    "description": "The notifications capability is not available on this client.",
	    "domain": "notifications",
	    "errorNumber": 9006,
	    "kind": "unavailable",
	    "retry": "safe",
	    "status": 503
	  }
	]);
