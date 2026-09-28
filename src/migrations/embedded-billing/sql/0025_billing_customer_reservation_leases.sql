ALTER TABLE billing.billing_subject_bindings
    ADD COLUMN IF NOT EXISTS reservation_token text,
    ADD COLUMN IF NOT EXISTS reservation_expires_at timestamptz,
    ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_error text;

INSERT INTO athena_billing_migrations (version, name, checksum)
SELECT 25, 'billing_customer_reservation_leases', 'billing-customer-reservation-leases-v1'
WHERE NOT EXISTS (
    SELECT 1 FROM athena_billing_migrations WHERE version = 25
);
