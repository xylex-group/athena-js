ALTER TABLE billing.billing_webhook_registrations
    ADD COLUMN IF NOT EXISTS reconciliation_state text
        CHECK (
            reconciliation_state IS NULL
            OR reconciliation_state IN (
                'create_pending',
                'remote_created_secret_pending',
                'active',
                'rotation_required',
                'update_pending',
                'failed'
            )
        );

CREATE TABLE IF NOT EXISTS billing.billing_webhook_secret_remediation (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    registration_id uuid,
    outcome text NOT NULL,
    detail text,
    created_at timestamptz NOT NULL DEFAULT now ()
);

INSERT INTO athena_billing_migrations (version, name, checksum)
SELECT 26, 'billing_webhook_reconciliation_states', 'billing-webhook-reconciliation-states-v1'
WHERE NOT EXISTS (
    SELECT 1 FROM athena_billing_migrations WHERE version = 26
);
