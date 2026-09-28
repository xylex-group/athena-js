-- account_reference = declared/local connection identity (upsert key).
-- provider_account_id = provider-confirmed remote identity; null until
-- discovery/verification. Do not invent Mollie organization ids.

ALTER TABLE billing.billing_provider_connections
    ALTER COLUMN provider_account_id DROP NOT NULL;

ALTER TABLE billing.billing_provider_connections
    DROP CONSTRAINT IF EXISTS billing_provider_connections_provider_account_id_check;

ALTER TABLE billing.billing_provider_connections
    ADD CONSTRAINT billing_provider_connections_provider_account_id_check CHECK (
        provider_account_id IS NULL OR btrim(provider_account_id) <> ''
    );

INSERT INTO athena_billing_migrations (version, name, checksum)
SELECT 18, 'billing_provider_account_id_nullable', 'billing-provider-account-id-nullable-v1'
WHERE NOT EXISTS (
    SELECT 1 FROM athena_billing_migrations WHERE version = 18
);
