-- Rename the Billing contact timestamp to reflect that Auth exposes a
-- verification boolean, not the time at which that boolean was established.

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'billing'
          AND table_name = 'billing_subject_bindings'
          AND column_name = 'email_verified_at'
    ) AND NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'billing'
          AND table_name = 'billing_subject_bindings'
          AND column_name = 'email_observed_at'
    ) THEN
        ALTER TABLE billing.billing_subject_bindings
            RENAME COLUMN email_verified_at TO email_observed_at;
    END IF;
END
$$;

INSERT INTO athena_billing_migrations (version, name, checksum)
SELECT 34, 'billing_contact_observation', 'billing-contact-observation-v1'
WHERE NOT EXISTS (
    SELECT 1
    FROM athena_billing_migrations
    WHERE version = 34
);
