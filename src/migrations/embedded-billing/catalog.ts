import billingCanonicalSql from "./sql/0001_billing_canonical.sql";
import billingSubjectBindingsSql from "./sql/0002_billing_subject_bindings.sql";
import billingSubjectFinalitySql from "./sql/0003_billing_subject_finality.sql";
import billingCustomerImportSql from "./sql/0004_billing_customer_import.sql";
import billingReconciliationObservabilitySql from "./sql/0005_billing_reconciliation_observability.sql";
import billingWebhookManagementSql from "./sql/0006_billing_webhook_management.sql";
import billingConnectionCredentialReferenceSql from "./sql/0007_billing_connection_credential_reference.sql";
import billingWebhookIngressObservabilitySql from "./sql/0008_billing_webhook_ingress_observability.sql";
import billingWebhookDeliveryHealthSql from "./sql/0009_billing_webhook_delivery_health.sql";
import billingCheckoutSessionsSql from "./sql/0010_billing_checkout_sessions.sql";
import billingSubjectBindingUniquenessSql from "./sql/0011_billing_subject_binding_uniqueness.sql";
import billingReconciliationLeaseEpochSql from "./sql/0012_billing_reconciliation_lease_epoch.sql";
import billingAuditFailureOutcomeSql from "./sql/0013_billing_audit_failure_outcome.sql";
import billingConnectionDeclaredSlotSql from "./sql/0014_billing_connection_declared_slot.sql";
import billingWebhookSigningSecretsSql from "./sql/0015_billing_webhook_signing_secrets.sql";
import billingCheckoutReturnFinalitySql from "./sql/0016_billing_checkout_return_finality.sql";
import billingWebhookIngressStageCatalogSql from "./sql/0017_billing_webhook_ingress_stage_catalog.sql";
import billingProviderAccountIdNullableSql from "./sql/0018_billing_provider_account_id_nullable.sql";
import billingEntitlementsSql from "./sql/0019_billing_entitlements.sql";
import billingBindingConflictsSql from "./sql/0020_billing_binding_conflicts.sql";
import billingWebhookIngressSubjectRefreshSql from "./sql/0021_billing_webhook_ingress_subject_refresh.sql";
import billingWebhookIngressRejectionEvidenceSql from "./sql/0022_billing_webhook_ingress_rejection_evidence.sql";
import billingSubscriptionEnrollmentsSql from "./sql/0023_billing_subscription_enrollments.sql";
import billingConnectionOwnerSlotSql from "./sql/0024_billing_connection_owner_slot.sql";
import billingCustomerReservationLeasesSql from "./sql/0025_billing_customer_reservation_leases.sql";
import billingWebhookReconciliationStatesSql from "./sql/0026_billing_webhook_reconciliation_states.sql";
import billingSubjectBindingEvidenceSql from "./sql/0027_billing_subject_binding_evidence.sql";
import billingEnrollmentFencingAndPlanChangeSql from "./sql/0028_billing_enrollment_fencing_and_plan_change.sql";
import billingProviderEffectJournalSql from "./sql/0029_billing_provider_effect_journal.sql";
import billingContactProvenanceSql from "./sql/0030_billing_contact_provenance.sql";
import billingWebhookLifecycleSql from "./sql/0031_billing_webhook_lifecycle.sql";
import billingSubscriptionUpdatedAtSql from "./sql/0032_billing_subscription_updated_at.sql";
import billingPlanChangeLiveStatesSql from "./sql/0033_billing_plan_change_live_states.sql";
import billingContactObservationSql from "./sql/0034_billing_contact_observation.sql";
import billingCheckoutSessionLinesSql from "./sql/0035_billing_checkout_session_lines.sql";
import billingBindingConflictIdentitySql from "./sql/0036_billing_binding_conflict_identity.sql";
import billingWebhookIngressBoundedEvidenceSql from "./sql/0037_billing_webhook_ingress_bounded_evidence.sql";
import billingWebhookIngressNullableDigestSql from "./sql/0038_billing_webhook_ingress_nullable_digest.sql";

export const EMBEDDED_BILLING_LEDGER = "athena_billing_migrations";

export const EMBEDDED_BILLING_REQUIRED_TABLES = [
  "billing_payments",
  "billing_subscriptions",
  "billing_invoices",
  "billing_subject_bindings",
  "billing_provider_connections",
  "billing_webhook_events",
  "billing_projection_events",
  "billing_import_state",
  "billing_import_runs",
  "billing_import_candidates",
  "billing_reconciliation_leases",
  "billing_webhook_registrations",
  "billing_webhook_ingress_stages",
  "billing_webhook_ingress_rejections",
  "billing_webhook_delivery_health",
  "billing_checkout_sessions",
  "billing_checkout_session_lines",
  "billing_entitlements",
  "billing_binding_conflicts",
  "billing_subscription_enrollments",
  "billing_webhook_secret_remediation",
  "billing_subject_binding_evidence",
  "billing_plan_change_operations",
  "billing_provider_effects",
] as const;

export const EMBEDDED_BILLING_REQUIRED_INTERNAL_TABLES = [
  "billing_webhook_signing_secrets",
] as const;

export const EMBEDDED_BILLING_REQUIRED_ATHENA_TABLES = [
  "audit_log_billing",
  "traces_billing",
] as const;

export const EMBEDDED_BILLING_REQUIRED_RELATIONS = [
  ...EMBEDDED_BILLING_REQUIRED_TABLES.map((table) => ({
    schema: "billing",
    table,
  })),
  ...EMBEDDED_BILLING_REQUIRED_INTERNAL_TABLES.map((table) => ({
    schema: "athena_internal",
    table,
  })),
  ...EMBEDDED_BILLING_REQUIRED_ATHENA_TABLES.map((table) => ({
    schema: "athena",
    table,
  })),
] as const;

const EMBEDDED_BILLING_REQUIRED_SUBSCRIPTION_FENCING_COLUMNS = [
  {
    column: "row_version",
    schema: "billing",
    table: "billing_subscriptions",
  },
] as const;

const EMBEDDED_BILLING_REQUIRED_BINDING_CONFLICT_COLUMNS = [
  {
    column: "last_observed_at",
    schema: "billing",
    table: "billing_binding_conflicts",
  },
  {
    column: "observation_count",
    schema: "billing",
    table: "billing_binding_conflicts",
  },
] as const;

export const EMBEDDED_BILLING_REQUIRED_COLUMNS = [
  ...EMBEDDED_BILLING_REQUIRED_SUBSCRIPTION_FENCING_COLUMNS,
  {
    column: "updated_at",
    schema: "billing",
    table: "billing_subscriptions",
  },
  ...EMBEDDED_BILLING_REQUIRED_BINDING_CONFLICT_COLUMNS,
] as const;

export const EMBEDDED_BILLING_MIGRATIONS = [
  {
    checksum: "billing-canonical-v1",
    filename: "0001_billing_canonical.sql",
    name: "billing_canonical",
    sql: billingCanonicalSql,
    version: 1,
  },
  {
    checksum: "billing-subject-bindings-v1",
    filename: "0002_billing_subject_bindings.sql",
    name: "billing_subject_bindings",
    sql: billingSubjectBindingsSql,
    version: 2,
  },
  {
    checksum: "billing-subject-finality-v2",
    filename: "0003_billing_subject_finality.sql",
    name: "billing_subject_finality",
    sql: billingSubjectFinalitySql,
    version: 3,
  },
  {
    checksum: "billing-customer-import-v1",
    filename: "0004_billing_customer_import.sql",
    name: "billing_customer_import",
    sql: billingCustomerImportSql,
    version: 4,
  },
  {
    checksum: "billing-reconciliation-observability-v1",
    filename: "0005_billing_reconciliation_observability.sql",
    name: "billing_reconciliation_observability",
    sql: billingReconciliationObservabilitySql,
    version: 5,
  },
  {
    checksum: "billing-webhook-management-v1",
    filename: "0006_billing_webhook_management.sql",
    name: "billing_webhook_management",
    sql: billingWebhookManagementSql,
    version: 6,
  },
  {
    checksum: "billing-connection-credential-reference-v1",
    filename: "0007_billing_connection_credential_reference.sql",
    name: "billing_connection_credential_reference",
    sql: billingConnectionCredentialReferenceSql,
    version: 7,
  },
  {
    checksum: "billing-webhook-ingress-observability-v1",
    filename: "0008_billing_webhook_ingress_observability.sql",
    name: "billing_webhook_ingress_observability",
    sql: billingWebhookIngressObservabilitySql,
    version: 8,
  },
  {
    checksum: "billing-webhook-delivery-health-v1",
    filename: "0009_billing_webhook_delivery_health.sql",
    name: "billing_webhook_delivery_health",
    sql: billingWebhookDeliveryHealthSql,
    version: 9,
  },
  {
    checksum: "billing-checkout-sessions-v1",
    filename: "0010_billing_checkout_sessions.sql",
    name: "billing_checkout_sessions",
    sql: billingCheckoutSessionsSql,
    version: 10,
  },
  {
    checksum: "billing-subject-binding-uniqueness-v1",
    filename: "0011_billing_subject_binding_uniqueness.sql",
    name: "billing_subject_binding_uniqueness",
    sql: billingSubjectBindingUniquenessSql,
    version: 11,
  },
  {
    checksum: "billing-reconciliation-lease-epoch-v1",
    filename: "0012_billing_reconciliation_lease_epoch.sql",
    name: "billing_reconciliation_lease_epoch",
    sql: billingReconciliationLeaseEpochSql,
    version: 12,
  },
  {
    checksum: "billing-audit-failure-outcome-v1",
    filename: "0013_billing_audit_failure_outcome.sql",
    name: "billing_audit_failure_outcome",
    sql: billingAuditFailureOutcomeSql,
    version: 13,
  },
  {
    checksum: "billing-connection-declared-slot-v1",
    filename: "0014_billing_connection_declared_slot.sql",
    name: "billing_connection_declared_slot",
    sql: billingConnectionDeclaredSlotSql,
    version: 14,
  },
  {
    checksum: "billing-webhook-signing-secrets-v1",
    filename: "0015_billing_webhook_signing_secrets.sql",
    name: "billing_webhook_signing_secrets",
    sql: billingWebhookSigningSecretsSql,
    version: 15,
  },
  {
    checksum: "billing-checkout-return-finality-v1",
    filename: "0016_billing_checkout_return_finality.sql",
    name: "billing_checkout_return_finality",
    sql: billingCheckoutReturnFinalitySql,
    version: 16,
  },
  {
    checksum: "billing-webhook-ingress-stage-catalog-v1",
    filename: "0017_billing_webhook_ingress_stage_catalog.sql",
    name: "billing_webhook_ingress_stage_catalog",
    sql: billingWebhookIngressStageCatalogSql,
    version: 17,
  },
  {
    checksum: "billing-provider-account-id-nullable-v1",
    filename: "0018_billing_provider_account_id_nullable.sql",
    name: "billing_provider_account_id_nullable",
    sql: billingProviderAccountIdNullableSql,
    version: 18,
  },
  {
    checksum: "billing-entitlements-v1",
    filename: "0019_billing_entitlements.sql",
    name: "billing_entitlements",
    sql: billingEntitlementsSql,
    version: 19,
  },
  {
    checksum: "billing-binding-conflicts-v1",
    filename: "0020_billing_binding_conflicts.sql",
    name: "billing_binding_conflicts",
    sql: billingBindingConflictsSql,
    version: 20,
  },
  {
    checksum: "billing-webhook-ingress-subject-refresh-v1",
    filename: "0021_billing_webhook_ingress_subject_refresh.sql",
    name: "billing_webhook_ingress_subject_refresh",
    sql: billingWebhookIngressSubjectRefreshSql,
    version: 21,
  },
  {
    checksum: "billing-webhook-ingress-rejection-evidence-v1",
    filename: "0022_billing_webhook_ingress_rejection_evidence.sql",
    name: "billing_webhook_ingress_rejection_evidence",
    sql: billingWebhookIngressRejectionEvidenceSql,
    version: 22,
  },
  {
    checksum: "billing-subscription-enrollments-v1",
    filename: "0023_billing_subscription_enrollments.sql",
    name: "billing_subscription_enrollments",
    sql: billingSubscriptionEnrollmentsSql,
    version: 23,
  },
  {
    checksum: "billing-connection-owner-slot-v1",
    filename: "0024_billing_connection_owner_slot.sql",
    name: "billing_connection_owner_slot",
    sql: billingConnectionOwnerSlotSql,
    version: 24,
  },
  {
    checksum: "billing-customer-reservation-leases-v1",
    filename: "0025_billing_customer_reservation_leases.sql",
    name: "billing_customer_reservation_leases",
    sql: billingCustomerReservationLeasesSql,
    version: 25,
  },
  {
    checksum: "billing-webhook-reconciliation-states-v1",
    filename: "0026_billing_webhook_reconciliation_states.sql",
    name: "billing_webhook_reconciliation_states",
    sql: billingWebhookReconciliationStatesSql,
    version: 26,
  },
  {
    checksum: "billing-subject-binding-evidence-v1",
    filename: "0027_billing_subject_binding_evidence.sql",
    name: "billing_subject_binding_evidence",
    sql: billingSubjectBindingEvidenceSql,
    version: 27,
  },
  {
    checksum: "billing-enrollment-fencing-plan-change-v1",
    filename: "0028_billing_enrollment_fencing_and_plan_change.sql",
    name: "billing_enrollment_fencing_and_plan_change",
    requiredColumns: EMBEDDED_BILLING_REQUIRED_SUBSCRIPTION_FENCING_COLUMNS,
    requiredRelations: EMBEDDED_BILLING_REQUIRED_RELATIONS,
    sql: billingEnrollmentFencingAndPlanChangeSql,
    version: 28,
  },
  {
    checksum: "billing-provider-effect-journal-v1",
    filename: "0029_billing_provider_effect_journal.sql",
    name: "billing_provider_effect_journal",
    requiredColumns: EMBEDDED_BILLING_REQUIRED_COLUMNS,
    requiredRelations: EMBEDDED_BILLING_REQUIRED_RELATIONS,
    sql: billingProviderEffectJournalSql,
    version: 29,
  },
  {
    checksum: "billing-contact-provenance-v1",
    filename: "0030_billing_contact_provenance.sql",
    name: "billing_contact_provenance",
    requiredColumns: EMBEDDED_BILLING_REQUIRED_COLUMNS,
    requiredRelations: EMBEDDED_BILLING_REQUIRED_RELATIONS,
    sql: billingContactProvenanceSql,
    version: 30,
  },
  {
    checksum: "billing-webhook-lifecycle-v1",
    filename: "0031_billing_webhook_lifecycle.sql",
    name: "billing_webhook_lifecycle",
    requiredColumns: EMBEDDED_BILLING_REQUIRED_COLUMNS,
    requiredRelations: EMBEDDED_BILLING_REQUIRED_RELATIONS,
    sql: billingWebhookLifecycleSql,
    version: 31,
  },
  {
    checksum: "billing-subscription-updated-at-v1",
    filename: "0032_billing_subscription_updated_at.sql",
    name: "billing_subscription_updated_at",
    requiredColumns: EMBEDDED_BILLING_REQUIRED_COLUMNS,
    requiredRelations: EMBEDDED_BILLING_REQUIRED_RELATIONS,
    sql: billingSubscriptionUpdatedAtSql,
    version: 32,
  },
  {
    checksum: "billing-plan-change-live-states-v1",
    filename: "0033_billing_plan_change_live_states.sql",
    name: "billing_plan_change_live_states",
    requiredColumns: EMBEDDED_BILLING_REQUIRED_COLUMNS,
    requiredRelations: EMBEDDED_BILLING_REQUIRED_RELATIONS,
    sql: billingPlanChangeLiveStatesSql,
    version: 33,
  },
  {
    checksum: "billing-contact-observation-v1",
    filename: "0034_billing_contact_observation.sql",
    name: "billing_contact_observation",
    requiredColumns: EMBEDDED_BILLING_REQUIRED_COLUMNS,
    requiredRelations: EMBEDDED_BILLING_REQUIRED_RELATIONS,
    sql: billingContactObservationSql,
    version: 34,
  },
  {
    checksum: "billing-checkout-session-lines-v1",
    filename: "0035_billing_checkout_session_lines.sql",
    name: "billing_checkout_session_lines",
    requiredColumns: EMBEDDED_BILLING_REQUIRED_COLUMNS,
    requiredRelations: EMBEDDED_BILLING_REQUIRED_RELATIONS,
    sql: billingCheckoutSessionLinesSql,
    version: 35,
  },
  {
    checksum: "billing-binding-conflict-identity-v1",
    filename: "0036_billing_binding_conflict_identity.sql",
    name: "billing_binding_conflict_identity",
    requiredColumns: EMBEDDED_BILLING_REQUIRED_COLUMNS,
    requiredRelations: EMBEDDED_BILLING_REQUIRED_RELATIONS,
    sql: billingBindingConflictIdentitySql,
    version: 36,
  },
  {
    checksum: "billing-webhook-ingress-bounded-evidence-v1",
    filename: "0037_billing_webhook_ingress_bounded_evidence.sql",
    name: "billing_webhook_ingress_bounded_evidence",
    requiredColumns: EMBEDDED_BILLING_REQUIRED_COLUMNS,
    requiredRelations: EMBEDDED_BILLING_REQUIRED_RELATIONS,
    sql: billingWebhookIngressBoundedEvidenceSql,
    version: 37,
  },
  {
    checksum: "billing-webhook-ingress-nullable-digest-v1",
    filename: "0038_billing_webhook_ingress_nullable_digest.sql",
    name: "billing_webhook_ingress_nullable_digest",
    requiredColumns: EMBEDDED_BILLING_REQUIRED_COLUMNS,
    requiredRelations: EMBEDDED_BILLING_REQUIRED_RELATIONS,
    sql: billingWebhookIngressNullableDigestSql,
    version: 38,
  },
] as const;

export const AUTH_UI_BILLING_PRESET_TABLES = [
  "billing_provider_connections",
  "billing_webhook_events",
  "billing_projection_events",
  "billing_import_runs",
  "billing_import_candidates",
  "billing_webhook_registrations",
] as const;
