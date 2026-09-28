CREATE SCHEMA IF NOT EXISTS billing;

CREATE TABLE IF NOT EXISTS athena_billing_migrations (
  version integer PRIMARY KEY,
  name text NOT NULL,
  checksum text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);

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

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_payments_provider_payment_id
    ON billing.billing_payments (provider, provider_payment_id);

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

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_subscriptions_provider_subscription_id
    ON billing.billing_subscriptions (provider, provider_subscription_id);

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

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_invoices_provider_invoice_id
    ON billing.billing_invoices (provider, provider_invoice_id);
