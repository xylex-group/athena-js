-- Billing webhook management: owned provider registrations + lease kind.
-- Apply after 0005. Do not store signing secrets.

ALTER TABLE billing.billing_reconciliation_leases
    DROP CONSTRAINT IF EXISTS billing_reconciliation_leases_resource_kind_check;

ALTER TABLE billing.billing_reconciliation_leases
    ADD CONSTRAINT billing_reconciliation_leases_resource_kind_check CHECK (
        resource_kind IN ('customers', 'webhook_registrations')
    );

CREATE TABLE IF NOT EXISTS billing.billing_webhook_registrations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    connection_id uuid NOT NULL REFERENCES billing.billing_provider_connections (id),
    provider text NOT NULL,
    provider_webhook_id text,
    kind text NOT NULL,
    environment text NOT NULL,
    name text NOT NULL,
    url text NOT NULL,
    event_types jsonb NOT NULL DEFAULT '[]'::jsonb,
    status text NOT NULL,
    config_hash text NOT NULL,
    secret_version integer,
    secret_fingerprint text,
    last_reconciled_at timestamptz,
    last_verified_at timestamptz,
    last_delivery_at timestamptz,
    last_error jsonb,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now (),
    updated_at timestamptz NOT NULL DEFAULT now (),
    CONSTRAINT billing_webhook_registrations_kind_check CHECK (
        kind IN ('classic', 'next_gen')
    ),
    CONSTRAINT billing_webhook_registrations_environment_check CHECK (
        environment IN ('test', 'live')
    ),
    CONSTRAINT billing_webhook_registrations_status_check CHECK (
        status IN (
            'pending',
            'active',
            'drifted',
            'degraded',
            'disabled',
            'error'
        )
    ),
    CONSTRAINT billing_webhook_registrations_connection_kind_key UNIQUE (connection_id, kind)
);

CREATE UNIQUE INDEX IF NOT EXISTS billing_webhook_registrations_provider_webhook_id_uidx
    ON billing.billing_webhook_registrations (provider_webhook_id)
    WHERE provider_webhook_id IS NOT NULL;

INSERT INTO athena_billing_migrations (version, name, checksum)
SELECT 6, 'billing_webhook_management', 'billing-webhook-management-v1'
WHERE NOT EXISTS (
    SELECT 1 FROM athena_billing_migrations WHERE version = 6
);
