/* AUTO-GENERATED from contracts/webhooks/errors.json. Do not hand-edit. */
import type { AthenaErrorIR } from "../ir.ts";

export const ATHENA_WEBHOOK_ERROR_DESCRIPTORS: readonly AthenaErrorIR<string, "webhook">[] =
	Object.freeze([
	  {
	    "code": "webhook_not_found",
	    "description": "The requested gateway webhook definition does not exist.",
	    "domain": "webhook",
	    "errorNumber": 6000,
	    "kind": "not_found",
	    "retry": "never",
	    "status": 404
	  },
	  {
	    "code": "webhook_sink_not_found",
	    "description": "The requested gateway webhook sink definition does not exist.",
	    "domain": "webhook",
	    "errorNumber": 6001,
	    "kind": "not_found",
	    "retry": "never",
	    "status": 404
	  },
	  {
	    "code": "webhook_sink_provision_failed",
	    "description": "Athena could not persist the requested webhook sink definition set.",
	    "domain": "webhook",
	    "errorNumber": 6002,
	    "kind": "internal",
	    "retry": "never",
	    "status": 500
	  }
	]);
