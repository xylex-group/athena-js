-- Webhook operator health: accepted/rejected delivery + bounded stage ledger.
-- Do not store signing secrets or webhook payloads.

ALTER TABLE billing.billing_webhook_registrations
    ADD COLUMN IF NOT EXISTS last_accepted_at timestamptz;

ALTER TABLE billing.billing_webhook_registrations
    ADD COLUMN IF NOT EXISTS last_rejected_at timestamptz;

ALTER TABLE billing.billing_webhook_registrations
    ADD COLUMN IF NOT EXISTS last_rejection_code text;

ALTER TABLE billing.billing_webhook_registrations
    ADD COLUMN IF NOT EXISTS last_reconciliation_outcome text;

ALTER TABLE billing.billing_webhook_registrations
    ADD COLUMN IF NOT EXISTS last_ingress_stage text;

ALTER TABLE billing.billing_webhook_registrations
    DROP CONSTRAINT IF EXISTS billing_webhook_registrations_reconciliation_outcome_check;

ALTER TABLE billing.billing_webhook_registrations
    ADD CONSTRAINT billing_webhook_registrations_reconciliation_outcome_check CHECK (
        last_reconciliation_outcome IS NULL
        OR last_reconciliation_outcome IN ('completed', 'failed', 'skipped')
    );

CREATE TABLE IF NOT EXISTS billing.billing_webhook_ingress_stages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    connection_id uuid REFERENCES billing.billing_provider_connections (id),
    ingress_id uuid,
    kind text NOT NULL,
    stage text NOT NULL,
    rejection_code text,
    correlation_id text,
    trace_id text,
    occurred_at timestamptz NOT NULL DEFAULT now (),
    CONSTRAINT billing_webhook_ingress_stages_kind_check CHECK (
        kind IN ('classic', 'next_gen')
    ),
    CONSTRAINT billing_webhook_ingress_stages_stage_check CHECK (
        stage IN (
            'received',
            'parsed',
            'verified',
            'authoritative_refetch_started',
            'authoritative_refetch_completed',
            'canonicalized',
            'persisted',
            'reconciliation_started',
            'reconciliation_completed',
            'duplicate',
            'failed'
        )
    )
);

CREATE INDEX IF NOT EXISTS billing_webhook_ingress_stages_connection_occurred_idx
    ON billing.billing_webhook_ingress_stages (connection_id, occurred_at DESC);

INSERT INTO athena_billing_migrations (version, name, checksum)
SELECT 8, 'billing_webhook_ingress_observability', 'billing-webhook-ingress-observability-v1'
WHERE NOT EXISTS (
    SELECT 1 FROM athena_billing_migrations WHERE version = 8
);
