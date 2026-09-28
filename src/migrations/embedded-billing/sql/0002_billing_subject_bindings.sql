-- Canonical Athena subject ↔ provider locator bindings.
-- Email is contact snapshot only. Provider IDs are never Athena identity.
-- Self-contained: this file may run before 0001 on a database that has
-- never applied embedded Billing (no `billing` schema yet).

CREATE SCHEMA IF NOT EXISTS billing;

CREATE TABLE IF NOT EXISTS billing.billing_payments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    provider text NOT NULL,
    provider_payment_id text NOT NULL,
    provider_customer_id text,
    provider_profile_id text,
    provider_subscription_id text,
    provider_payment_link_id text,
    status text NOT NULL,
    amount_currency text NOT NULL,
    amount_value numeric(18, 6) NOT NULL,
    amount_refunded_currency text,
    amount_refunded_value numeric(18, 6),
    description text,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    raw jsonb NOT NULL DEFAULT '{}'::jsonb,
    paid_at timestamptz,
    created_at timestamptz,
    ingested_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT billing_payments_provider_check CHECK (provider IN ('mollie', 'stripe')),
    CONSTRAINT billing_payments_status_check CHECK (
        status IN ('pending', 'authorized', 'paid', 'failed', 'canceled', 'refunded')
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_payments_provider_payment_id ON billing.billing_payments (provider, provider_payment_id);

CREATE TABLE IF NOT EXISTS billing.billing_subscriptions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    provider text NOT NULL,
    provider_subscription_id text NOT NULL,
    provider_customer_id text NOT NULL,
    provider_profile_id text,
    status text NOT NULL,
    amount_currency text,
    amount_value numeric(18, 6),
    interval text,
    description text,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    raw jsonb NOT NULL DEFAULT '{}'::jsonb,
    next_payment_date text,
    created_at timestamptz,
    canceled_at timestamptz,
    ingested_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT billing_subscriptions_provider_check CHECK (provider IN ('mollie', 'stripe'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_subscriptions_provider_subscription_id ON billing.billing_subscriptions (
    provider,
    provider_subscription_id
);

CREATE TABLE IF NOT EXISTS billing.billing_invoices (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    provider text NOT NULL,
    provider_invoice_id text NOT NULL,
    provider_profile_id text,
    provider_customer_id text,
    status text NOT NULL,
    amount_currency text,
    amount_value numeric(18, 6),
    amount_paid_currency text,
    amount_paid_value numeric(18, 6),
    description text,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    raw jsonb NOT NULL DEFAULT '{}'::jsonb,
    issued_at timestamptz,
    paid_at timestamptz,
    created_at timestamptz,
    ingested_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT billing_invoices_provider_check CHECK (provider IN ('mollie', 'stripe'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_invoices_provider_invoice_id ON billing.billing_invoices (provider, provider_invoice_id);

CREATE TABLE IF NOT EXISTS billing.billing_subject_bindings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    connection_id text NOT NULL,
    subject_kind text NOT NULL,
    subject_id text NOT NULL,
    provider_subject_kind text NOT NULL,
    provider_subject_id text NOT NULL,
    status text NOT NULL DEFAULT 'pending',
    source text NOT NULL,
    is_primary boolean NOT NULL DEFAULT false,
    email_snapshot text,
    created_at timestamptz NOT NULL DEFAULT now (),
    updated_at timestamptz NOT NULL DEFAULT now (),
    CONSTRAINT billing_subject_bindings_subject_kind_check CHECK (
        subject_kind IN ('user', 'organization')
    ),
    CONSTRAINT billing_subject_bindings_provider_subject_kind_check CHECK (
        provider_subject_kind IN ('customer', 'recipient')
    ),
    CONSTRAINT billing_subject_bindings_status_check CHECK (
        status IN (
            'pending',
            'active',
            'conflict',
            'revoked'
        )
    ),
    CONSTRAINT billing_subject_bindings_source_check CHECK (
        source IN (
            'created',
            'imported',
            'reconciled'
        )
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_subject_bindings_provider_locator ON billing.billing_subject_bindings (
    connection_id,
    provider_subject_kind,
    provider_subject_id
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_subject_bindings_one_primary ON billing.billing_subject_bindings (
    connection_id,
    subject_kind,
    subject_id,
    provider_subject_kind
)
WHERE
    status = 'active'
    AND is_primary;

CREATE INDEX IF NOT EXISTS idx_billing_subject_bindings_subject ON billing.billing_subject_bindings (
    subject_kind,
    subject_id,
    connection_id
);

ALTER TABLE billing.billing_payments
ADD COLUMN IF NOT EXISTS connection_id text,
ADD COLUMN IF NOT EXISTS subject_kind text,
ADD COLUMN IF NOT EXISTS subject_id text,
ADD COLUMN IF NOT EXISTS ownership_status text NOT NULL DEFAULT 'unresolved';

ALTER TABLE billing.billing_subscriptions
ADD COLUMN IF NOT EXISTS connection_id text,
ADD COLUMN IF NOT EXISTS subject_kind text,
ADD COLUMN IF NOT EXISTS subject_id text,
ADD COLUMN IF NOT EXISTS ownership_status text NOT NULL DEFAULT 'unresolved';

ALTER TABLE billing.billing_invoices
ADD COLUMN IF NOT EXISTS connection_id text,
ADD COLUMN IF NOT EXISTS subject_kind text,
ADD COLUMN IF NOT EXISTS subject_id text,
ADD COLUMN IF NOT EXISTS ownership_status text NOT NULL DEFAULT 'unresolved';

ALTER TABLE billing.billing_payments
DROP CONSTRAINT IF EXISTS billing_payments_ownership_status_check;

ALTER TABLE billing.billing_payments
ADD CONSTRAINT billing_payments_ownership_status_check CHECK (
    ownership_status IN (
        'resolved',
        'unresolved',
        'conflict'
    )
);

ALTER TABLE billing.billing_subscriptions
DROP CONSTRAINT IF EXISTS billing_subscriptions_ownership_status_check;

ALTER TABLE billing.billing_subscriptions
ADD CONSTRAINT billing_subscriptions_ownership_status_check CHECK (
    ownership_status IN (
        'resolved',
        'unresolved',
        'conflict'
    )
);

ALTER TABLE billing.billing_invoices
DROP CONSTRAINT IF EXISTS billing_invoices_ownership_status_check;

ALTER TABLE billing.billing_invoices
ADD CONSTRAINT billing_invoices_ownership_status_check CHECK (
    ownership_status IN (
        'resolved',
        'unresolved',
        'conflict'
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_payments_connection_provider_payment ON billing.billing_payments (
    connection_id,
    provider_payment_id
)
WHERE
    connection_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_subscriptions_connection_provider_subscription ON billing.billing_subscriptions (
    connection_id,
    provider_subscription_id
)
WHERE
    connection_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_invoices_connection_provider_invoice ON billing.billing_invoices (
    connection_id,
    provider_invoice_id
)
WHERE
    connection_id IS NOT NULL;