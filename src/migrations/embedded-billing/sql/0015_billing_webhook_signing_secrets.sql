-- Encrypted webhook signing secrets. Plaintext must never enter
-- billing.billing_webhook_registrations.metadata or generated registries.
-- Schema athena_internal is excluded from application Data HTTP models.

CREATE SCHEMA IF NOT EXISTS athena_internal;

CREATE TABLE IF NOT EXISTS athena_internal.billing_webhook_signing_secrets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    connection_id uuid NOT NULL REFERENCES billing.billing_provider_connections (id),
    key_version integer NOT NULL DEFAULT 1,
    fingerprint text NOT NULL,
    ciphertext text NOT NULL,
    status text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now (),
    retired_at timestamptz,
    CONSTRAINT billing_webhook_signing_secrets_status_check CHECK (
        status IN ('current', 'previous', 'retired')
    ),
    CONSTRAINT billing_webhook_signing_secrets_connection_fingerprint_key UNIQUE (connection_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS billing_webhook_signing_secrets_connection_status_idx
    ON athena_internal.billing_webhook_signing_secrets (connection_id, status);

UPDATE billing.billing_webhook_registrations
SET
    metadata = metadata - 'providerSigningSecret'
WHERE
    metadata ? 'providerSigningSecret';

INSERT INTO athena_billing_migrations (version, name, checksum)
SELECT 15, 'billing_webhook_signing_secrets', 'billing-webhook-signing-secrets-v1'
WHERE NOT EXISTS (
    SELECT 1 FROM athena_billing_migrations WHERE version = 15
);
