-- Durable checkout return correlation: opaque token hash, attempt kind, expiry.
-- Do not store the plaintext return token or provider secrets.

ALTER TABLE billing.billing_checkout_sessions
    ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'subscription_enrollment';

ALTER TABLE billing.billing_checkout_sessions
    ADD COLUMN IF NOT EXISTS connection_id text;

ALTER TABLE billing.billing_checkout_sessions
    ADD COLUMN IF NOT EXISTS return_nonce_hash text;

ALTER TABLE billing.billing_checkout_sessions
    ADD COLUMN IF NOT EXISTS expires_at timestamptz;

ALTER TABLE billing.billing_checkout_sessions
    DROP CONSTRAINT IF EXISTS billing_checkout_sessions_kind_check;

ALTER TABLE billing.billing_checkout_sessions
    ADD CONSTRAINT billing_checkout_sessions_kind_check CHECK (
        kind IN ('one_off', 'subscription_enrollment')
    );

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_checkout_sessions_return_nonce
    ON billing.billing_checkout_sessions (return_nonce_hash)
    WHERE return_nonce_hash IS NOT NULL;

INSERT INTO athena_billing_migrations (version, name, checksum)
SELECT 16, 'billing_checkout_return_finality', 'billing-checkout-return-finality-v1'
WHERE NOT EXISTS (
    SELECT 1 FROM athena_billing_migrations WHERE version = 16
);
