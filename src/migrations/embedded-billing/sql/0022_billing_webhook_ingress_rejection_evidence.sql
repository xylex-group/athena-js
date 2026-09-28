-- Operator evidence for rejected Mollie webhook envelopes.
-- Stage ledger stays payload-free; this table holds attempted vs expected bodies.

CREATE TABLE IF NOT EXISTS billing.billing_webhook_ingress_rejections (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    connection_id uuid REFERENCES billing.billing_provider_connections (id),
    ingress_id uuid,
    kind text NOT NULL,
    code text NOT NULL,
    content_type text,
    body_kind text,
    body_bytes integer,
    attempted_body text NOT NULL,
    expected_envelope jsonb NOT NULL,
    occurred_at timestamptz NOT NULL DEFAULT now (),
    CONSTRAINT billing_webhook_ingress_rejections_kind_check CHECK (
        kind IN ('classic', 'next_gen')
    )
);

CREATE INDEX IF NOT EXISTS billing_webhook_ingress_rejections_occurred_idx
    ON billing.billing_webhook_ingress_rejections (occurred_at DESC);

CREATE INDEX IF NOT EXISTS billing_webhook_ingress_rejections_connection_idx
    ON billing.billing_webhook_ingress_rejections (connection_id, occurred_at DESC);

INSERT INTO athena_billing_migrations (version, name, checksum)
SELECT 22, 'billing_webhook_ingress_rejection_evidence', 'billing-webhook-ingress-rejection-evidence-v1'
WHERE NOT EXISTS (
    SELECT 1 FROM athena_billing_migrations WHERE version = 22
);
