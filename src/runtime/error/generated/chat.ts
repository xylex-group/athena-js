/* AUTO-GENERATED from contracts/chat/errors.json. Do not hand-edit. */
import type { AthenaErrorIR } from "../ir.ts";

export const ATHENA_CHAT_ERROR_DESCRIPTORS: readonly AthenaErrorIR<string, "chat">[] =
	Object.freeze([
	  {
	    "code": "chat_auth_required",
	    "description": "The chat route requires an authenticated actor.",
	    "domain": "chat",
	    "errorNumber": 5000,
	    "kind": "authentication",
	    "retry": "never",
	    "status": 401
	  },
	  {
	    "code": "chat_forbidden",
	    "description": "The actor is not allowed to perform the requested chat action.",
	    "domain": "chat",
	    "errorNumber": 5001,
	    "kind": "authorization",
	    "retry": "never",
	    "status": 403
	  },
	  {
	    "code": "chat_not_found",
	    "description": "The requested chat room, member, message, or related resource was not found.",
	    "domain": "chat",
	    "errorNumber": 5002,
	    "kind": "not_found",
	    "retry": "never",
	    "status": 404
	  },
	  {
	    "code": "chat_conflict",
	    "description": "The requested chat mutation conflicts with the current durable chat state.",
	    "domain": "chat",
	    "errorNumber": 5003,
	    "kind": "conflict",
	    "retry": "never",
	    "status": 409
	  },
	  {
	    "code": "chat_validation_failed",
	    "description": "The chat request payload failed validation.",
	    "domain": "chat",
	    "errorNumber": 5004,
	    "kind": "validation",
	    "retry": "never",
	    "status": 400
	  },
	  {
	    "code": "chat_unavailable",
	    "description": "Athena chat is temporarily unavailable.",
	    "domain": "chat",
	    "errorNumber": 5005,
	    "kind": "unavailable",
	    "retry": "safe",
	    "status": 503
	  },
	  {
	    "code": "chat_unsupported",
	    "description": "The requested chat operation is not supported by this Athena runtime.",
	    "domain": "chat",
	    "errorNumber": 5006,
	    "kind": "unsupported",
	    "retry": "never",
	    "status": 400
	  },
	  {
	    "code": "chat_internal",
	    "description": "Athena chat failed while processing the request.",
	    "domain": "chat",
	    "errorNumber": 5007,
	    "kind": "internal",
	    "retry": "never",
	    "status": 500
	  },
	  {
	    "code": "chat_unauthenticated",
	    "description": "Chat authentication could not resolve an authenticated actor.",
	    "domain": "chat",
	    "errorNumber": 5008,
	    "kind": "authentication",
	    "retry": "never",
	    "status": 401
	  },
	  {
	    "code": "chat_authorization_denied",
	    "description": "The chat operation was denied because the actor lacks a required Right.",
	    "domain": "chat",
	    "errorNumber": 5009,
	    "kind": "authorization",
	    "retry": "never",
	    "status": 403
	  },
	  {
	    "code": "chat_membership_denied",
	    "description": "The actor is not a member of the requested chat room.",
	    "domain": "chat",
	    "errorNumber": 5010,
	    "kind": "authorization",
	    "retry": "never",
	    "status": 403
	  },
	  {
	    "code": "chat_role_denied",
	    "description": "The actor's chat role does not permit the requested operation.",
	    "domain": "chat",
	    "errorNumber": 5011,
	    "kind": "authorization",
	    "retry": "never",
	    "status": 403
	  },
	  {
	    "code": "chat_bad_request",
	    "description": "The chat request was invalid.",
	    "domain": "chat",
	    "errorNumber": 5012,
	    "kind": "validation",
	    "retry": "never",
	    "status": 400
	  },
	  {
	    "code": "chat_capability_unsupported",
	    "description": "The requested chat capability is unsupported by this runtime.",
	    "domain": "chat",
	    "errorNumber": 5013,
	    "kind": "unsupported",
	    "retry": "never",
	    "status": 501
	  },
	  {
	    "code": "chat_transaction_failed",
	    "description": "Chat state could not be committed.",
	    "domain": "chat",
	    "errorNumber": 5014,
	    "kind": "internal",
	    "retry": "never",
	    "status": 500
	  },
	  {
	    "code": "chat_publication_failed",
	    "description": "Chat state committed but its event could not be published.",
	    "domain": "chat",
	    "errorNumber": 5015,
	    "kind": "internal",
	    "retry": "never",
	    "status": 500
	  }
	]);
