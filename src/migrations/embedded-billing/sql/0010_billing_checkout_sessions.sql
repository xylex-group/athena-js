-- Durable self-service checkout / enrollment sessions.
-- Redirect completion is not billing finality; webhook advances the session.

CREATE TABLE IF NOT EXISTS billing.billing_checkout_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    idempotency_key text NOT NULL,
    subject_kind text NOT NULL,
    subject_id text NOT NULL,
    price_id text NOT NULL,
    provider text NOT NULL,
    provider_customer_id text,
    provider_payment_id text,
    provider_subscription_id text,
    status text NOT NULL,
    checkout_url text,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT billing_checkout_sessions_provider_check CHECK (
        provider IN ('mollie', 'stripe')
    ),
    CONSTRAINT billing_checkout_sessions_subject_kind_check CHECK (
        subject_kind IN ('user', 'organization')
    ),
    CONSTRAINT billing_checkout_sessions_status_check CHECK (
        status IN (
            'first_payment_required',
            'first_payment_paid',
            'first_payment_failed',
            'first_payment_canceled',
            'enrolled'
        )
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_checkout_sessions_idempotency
    ON billing.billing_checkout_sessions (
        subject_kind,
        subject_id,
        idempotency_key
    );

CREATE INDEX IF NOT EXISTS idx_billing_checkout_sessions_payment
    ON billing.billing_checkout_sessions (provider, provider_payment_id)
    WHERE provider_payment_id IS NOT NULL;
