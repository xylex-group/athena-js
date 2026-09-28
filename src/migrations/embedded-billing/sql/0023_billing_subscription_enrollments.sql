-- Subject-serialized recurring enrollment. One pending or active row per subject.

CREATE TABLE IF NOT EXISTS billing.billing_subscription_enrollments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    connection_id uuid NOT NULL REFERENCES billing.billing_provider_connections (id),
    subject_kind text NOT NULL CHECK (
        subject_kind IN ('user', 'organization')
    ),
    subject_id text NOT NULL,
    price_id text NOT NULL,
    idempotency_key text NOT NULL,
    state text NOT NULL CHECK (
        state IN (
            'reserved',
            'first_payment_pending',
            'advancing',
            'active',
            'failed',
            'canceled',
            'expired',
            'superseded'
        )
    ),
    provider_payment_id text,
    provider_subscription_id text,
    lease_token text,
    lease_expires_at timestamptz,
    attempt_count integer NOT NULL DEFAULT 0,
    last_error text,
    provider_idempotency_key text,
    journal_intent text,
    created_at timestamptz NOT NULL DEFAULT now (),
    updated_at timestamptz NOT NULL DEFAULT now (),
    UNIQUE (
        subject_kind,
        subject_id,
        idempotency_key
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS billing_subscription_enrollments_live_subject_uidx ON billing.billing_subscription_enrollments (subject_kind, subject_id)
WHERE
    state IN (
        'reserved',
        'first_payment_pending',
        'advancing',
        'active'
    );

INSERT INTO
    athena_billing_migrations (version, name, checksum)
SELECT 23, 'billing_subscription_enrollments', 'billing-subscription-enrollments-v1'
WHERE
    NOT EXISTS (
        SELECT 1
        FROM athena_billing_migrations
        WHERE
            version = 23
    );