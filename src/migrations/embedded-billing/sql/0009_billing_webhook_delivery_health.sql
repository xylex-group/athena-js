-- Delivery-health current-state rows (not registration config).
-- Stage-event columns for operator lifecycle traces. No signing secrets or payloads.

CREATE TABLE IF NOT EXISTS billing.billing_webhook_delivery_health (
    connection_id uuid NOT NULL REFERENCES billing.billing_provider_connections (id),
    kind text NOT NULL,
    last_received_at timestamptz,
    last_accepted_at timestamptz,
    last_rejected_at timestamptz,
    last_rejection_code text,
    last_rejection_message text,
    accepted_count bigint NOT NULL DEFAULT 0,
    rejected_count bigint NOT NULL DEFAULT 0,
    duplicate_count bigint NOT NULL DEFAULT 0,
    last_reconciliation_started_at timestamptz,
    last_reconciliation_completed_at timestamptz,
    last_reconciliation_failed_at timestamptz,
    last_reconciliation_outcome text,
    last_reconciliation_error text,
    updated_at timestamptz NOT NULL DEFAULT now (),
    PRIMARY KEY (connection_id, kind),
    CONSTRAINT billing_webhook_delivery_health_kind_check CHECK (
        kind IN ('classic', 'next_gen')
    ),
    CONSTRAINT billing_webhook_delivery_health_recon_outcome_check CHECK (
        last_reconciliation_outcome IS NULL
        OR last_reconciliation_outcome IN ('completed', 'failed', 'skipped')
    )
);

ALTER TABLE billing.billing_webhook_ingress_stages
    ADD COLUMN IF NOT EXISTS provider text;

ALTER TABLE billing.billing_webhook_ingress_stages
    ADD COLUMN IF NOT EXISTS operation text;

ALTER TABLE billing.billing_webhook_ingress_stages
    ADD COLUMN IF NOT EXISTS status text;

ALTER TABLE billing.billing_webhook_ingress_stages
    ADD COLUMN IF NOT EXISTS error_message text;

ALTER TABLE billing.billing_webhook_ingress_stages
    ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE billing.billing_webhook_ingress_stages
    DROP CONSTRAINT IF EXISTS billing_webhook_ingress_stages_stage_check;

ALTER TABLE billing.billing_webhook_ingress_stages
    ADD CONSTRAINT billing_webhook_ingress_stages_stage_check CHECK (
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
            'reconciliation_failed',
            'duplicate',
            'rejected',
            'failed'
        )
    );

CREATE INDEX IF NOT EXISTS billing_webhook_ingress_stages_ingress_idx
    ON billing.billing_webhook_ingress_stages (ingress_id);

CREATE INDEX IF NOT EXISTS billing_webhook_ingress_stages_trace_idx
    ON billing.billing_webhook_ingress_stages (trace_id);

CREATE INDEX IF NOT EXISTS billing_webhook_ingress_stages_stage_occurred_idx
    ON billing.billing_webhook_ingress_stages (stage, occurred_at DESC);

INSERT INTO athena_billing_migrations (version, name, checksum)
SELECT 9, 'billing_webhook_delivery_health', 'billing-webhook-delivery-health-v1'
WHERE NOT EXISTS (
    SELECT 1 FROM athena_billing_migrations WHERE version = 9
);
