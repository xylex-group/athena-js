-- Durable webhook registration/secret lifecycle.  Legacy reconciliation
-- states remain accepted so existing rows can be recovered in place.

ALTER TABLE billing.billing_webhook_registrations
    DROP CONSTRAINT IF EXISTS billing_webhook_registrations_reconciliation_state_check;

ALTER TABLE billing.billing_webhook_registrations
    ADD CONSTRAINT billing_webhook_registrations_reconciliation_state_check CHECK (
        reconciliation_state IS NULL
        OR reconciliation_state IN (
            'create_pending',
            'provider_registration_pending',
            'provider_registered_secret_pending',
            'secret_persisted_activation_pending',
            'verification_pending',
            'verification_failed',
            'remote_created_secret_pending',
            'active',
            'rotation_pending',
            'rotation_secret_pending',
            'rotation_required',
            'update_pending',
            'failed',
            'attention_required'
        )
    );

ALTER TABLE billing.billing_webhook_registrations
    ADD COLUMN IF NOT EXISTS provider_registration_idempotency_key text,
    ADD COLUMN IF NOT EXISTS provider_registration_attempts integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS secret_persistence_attempts integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS activation_attempts integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_provider_evidence jsonb,
    ADD COLUMN IF NOT EXISTS lifecycle_error jsonb,
    ADD COLUMN IF NOT EXISTS lifecycle_updated_at timestamptz;

CREATE INDEX IF NOT EXISTS billing_webhook_registrations_lifecycle_state_idx
    ON billing.billing_webhook_registrations (reconciliation_state, lifecycle_updated_at);

INSERT INTO athena_billing_migrations (version, name, checksum)
SELECT 31, 'billing_webhook_lifecycle', 'billing-webhook-lifecycle-v1'
WHERE NOT EXISTS (
    SELECT 1 FROM athena_billing_migrations WHERE version = 31
);
