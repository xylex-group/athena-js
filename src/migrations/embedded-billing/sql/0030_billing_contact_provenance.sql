-- Verified Auth contact evidence is distinct from the Athena subject identity.

ALTER TABLE billing.billing_subject_bindings
    ADD COLUMN IF NOT EXISTS email_verification_source text,
    ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;

ALTER TABLE billing.billing_subject_bindings
    DROP CONSTRAINT IF EXISTS billing_subject_bindings_email_verification_source_check;

ALTER TABLE billing.billing_subject_bindings
    ADD CONSTRAINT billing_subject_bindings_email_verification_source_check CHECK (
        email_verification_source IS NULL
        OR email_verification_source = 'athena-auth'
    );

INSERT INTO athena_billing_migrations (version, name, checksum)
SELECT 30, 'billing_contact_provenance', 'billing-contact-provenance-v1'
WHERE NOT EXISTS (
    SELECT 1 FROM athena_billing_migrations WHERE version = 30
);
