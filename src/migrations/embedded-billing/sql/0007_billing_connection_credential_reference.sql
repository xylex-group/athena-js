-- Per-connection credential authority. Secrets stay in process config;
-- connections store a durable reference only.

ALTER TABLE billing.billing_provider_connections
    ADD COLUMN IF NOT EXISTS credential_reference text;

UPDATE billing.billing_provider_connections
SET credential_reference = 'providers.' || lower(btrim(provider))
WHERE credential_reference IS NULL
   OR btrim(credential_reference) = '';

ALTER TABLE billing.billing_provider_connections
    ALTER COLUMN credential_reference SET DEFAULT 'providers.mollie';

ALTER TABLE billing.billing_provider_connections
    ALTER COLUMN credential_reference SET NOT NULL;

ALTER TABLE billing.billing_provider_connections
    DROP CONSTRAINT IF EXISTS billing_provider_connections_credential_reference_check;

ALTER TABLE billing.billing_provider_connections
    ADD CONSTRAINT billing_provider_connections_credential_reference_check CHECK (
        btrim(credential_reference) <> ''
    );

INSERT INTO athena_billing_migrations (version, name, checksum)
SELECT 7, 'billing_connection_credential_reference', 'billing-connection-credential-reference-v1'
WHERE NOT EXISTS (
    SELECT 1 FROM athena_billing_migrations WHERE version = 7
);
