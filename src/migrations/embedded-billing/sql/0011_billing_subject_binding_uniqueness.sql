-- At most one live (pending or active) provider subject per Athena subject
-- on a connection. Stops concurrent ensure/import from inserting a second
-- pending row after the first activates (which used to free the placeholder
-- locator and allow a second Mollie customer).

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_subject_bindings_one_live
    ON billing.billing_subject_bindings (
        connection_id,
        subject_kind,
        subject_id,
        provider_subject_kind
    )
    WHERE status IN ('pending', 'active');

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_subject_bindings_one_active
    ON billing.billing_subject_bindings (
        connection_id,
        subject_kind,
        subject_id,
        provider_subject_kind
    )
    WHERE status = 'active';

INSERT INTO athena_billing_migrations (version, name, checksum)
SELECT 11, 'billing_subject_binding_uniqueness', 'billing-subject-binding-uniqueness-v1'
WHERE NOT EXISTS (
    SELECT 1 FROM athena_billing_migrations WHERE version = 11
);
