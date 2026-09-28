/* AUTO-GENERATED from contracts/billing/errors.json. Do not hand-edit. */
import type { AthenaErrorIR } from "../ir.ts";

export const ATHENA_BILLING_ERROR_DESCRIPTORS: readonly AthenaErrorIR<string, "billing">[] =
	Object.freeze([
	  {
	    "code": "billing_webhook_secret_invalid",
	    "description": "The billing webhook secret did not match the configured connection secret.",
	    "domain": "billing",
	    "errorNumber": 4000,
	    "kind": "authentication",
	    "retry": "never",
	    "status": 401
	  },
	  {
	    "code": "billing_mollie_webhook_rejected",
	    "description": "Athena rejected the Mollie webhook after signature or payload verification failed.",
	    "domain": "billing",
	    "errorNumber": 4001,
	    "kind": "validation",
	    "retry": "never",
	    "status": 401
	  },
	  {
	    "code": "billing_connection_not_found",
	    "description": "The requested billing provider connection does not exist.",
	    "domain": "billing",
	    "errorNumber": 4002,
	    "kind": "not_found",
	    "retry": "never",
	    "status": 404
	  },
	  {
	    "code": "billing_provider_unsupported",
	    "description": "The requested billing provider is not supported by this Athena runtime.",
	    "domain": "billing",
	    "errorNumber": 4003,
	    "kind": "unsupported",
	    "retry": "never",
	    "status": 400
	  },
	  {
	    "code": "billing_provider_mismatch",
	    "description": "The billing provider path did not match the stored provider connection.",
	    "domain": "billing",
	    "errorNumber": 4004,
	    "kind": "validation",
	    "retry": "never",
	    "status": 400
	  },
	  {
	    "code": "billing_connection_config_invalid",
	    "description": "The stored billing provider connection config is invalid.",
	    "domain": "billing",
	    "errorNumber": 4005,
	    "kind": "unavailable",
	    "retry": "safe",
	    "status": 500
	  },
	  {
	    "code": "billing_adapter_failed",
	    "description": "The upstream billing provider adapter failed while fetching or projecting provider state.",
	    "domain": "billing",
	    "errorNumber": 4006,
	    "kind": "internal",
	    "retry": "never",
	    "status": 502
	  },
	  {
	    "code": "billing_auth_sync_failed",
	    "description": "Athena could not apply the projected billing grants to Athena Auth.",
	    "domain": "billing",
	    "errorNumber": 4007,
	    "kind": "internal",
	    "retry": "never",
	    "status": 502
	  },
	  {
	    "code": "billing_auth_sync_config_invalid",
	    "description": "The Athena Auth billing sync runtime configuration is invalid.",
	    "domain": "billing",
	    "errorNumber": 4008,
	    "kind": "internal",
	    "retry": "never",
	    "status": 500
	  },
	  {
	    "code": "billing_stripe_webhook_rejected",
	    "description": "Athena rejected the Stripe webhook after signature or payload verification failed.",
	    "domain": "billing",
	    "errorNumber": 4009,
	    "kind": "validation",
	    "retry": "never",
	    "status": 401
	  },
	  {
	    "code": "billing_webhook_payload_unsupported",
	    "description": "The billing webhook payload was valid but Athena does not project that event shape yet.",
	    "domain": "billing",
	    "errorNumber": 4010,
	    "kind": "unsupported",
	    "retry": "never",
	    "status": 422
	  },
	  {
	    "code": "billing_provider_response_invalid",
	    "description": "Athena could not parse the upstream billing provider response or webhook payload.",
	    "domain": "billing",
	    "errorNumber": 4011,
	    "kind": "internal",
	    "retry": "never",
	    "status": 502
	  },
	  {
	    "code": "billing_provider_http_failed",
	    "description": "Athena could not complete the required upstream billing provider HTTP request.",
	    "domain": "billing",
	    "errorNumber": 4012,
	    "kind": "internal",
	    "retry": "never",
	    "status": 502
	  },
	  {
	    "code": "billing_webhook_base_url_mismatch",
	    "description": "The billing webhook arrived on an Athena mirror URL that does not match the connection ingress policy.",
	    "domain": "billing",
	    "errorNumber": 4013,
	    "kind": "validation",
	    "retry": "never",
	    "status": 403
	  },
	  {
	    "code": "billing_authorization_denied",
	    "description": "The billing operation was denied because the principal is missing required Athena Rights.",
	    "domain": "billing",
	    "errorNumber": 4014,
	    "kind": "authorization",
	    "retry": "never",
	    "status": 403
	  },
	  {
	    "code": "billing_import_conflict",
	    "description": "Billing customer import found a conflicting subject mapping and did not change ownership.",
	    "domain": "billing",
	    "errorNumber": 4015,
	    "kind": "conflict",
	    "retry": "never",
	    "status": 409
	  },
	  {
	    "code": "billing_import_ambiguous_subject",
	    "description": "Billing customer import could not choose a unique Athena subject.",
	    "domain": "billing",
	    "errorNumber": 4016,
	    "kind": "validation",
	    "retry": "never",
	    "status": 409
	  },
	  {
	    "code": "billing_import_provider_failed",
	    "description": "Billing customer import could not list provider customers.",
	    "domain": "billing",
	    "errorNumber": 4017,
	    "kind": "internal",
	    "retry": "never",
	    "status": 502
	  },
	  {
	    "code": "billing_import_subject_not_found",
	    "description": "Billing customer import metadata pointed at an Athena subject that does not exist.",
	    "domain": "billing",
	    "errorNumber": 4018,
	    "kind": "not_found",
	    "retry": "never",
	    "status": 404
	  },
	  {
	    "code": "billing_import_binding_conflict",
	    "description": "Billing customer import could not bind a provider customer that is already mapped to another subject.",
	    "domain": "billing",
	    "errorNumber": 4019,
	    "kind": "conflict",
	    "retry": "never",
	    "status": 409
	  },
	  {
	    "code": "billing_import_cursor_invalid",
	    "description": "Billing customer import received an invalid provider list cursor.",
	    "domain": "billing",
	    "errorNumber": 4020,
	    "kind": "validation",
	    "retry": "never",
	    "status": 400
	  }
	]);
