-- Align ingress stage CHECK with the TypeScript stage catalog.
-- v8 allowed `failed` only; handlers and TS use `rejected` / `reconciliation_failed`.
-- Keep `failed` for existing rows.

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

INSERT INTO athena_billing_migrations (version, name, checksum)
SELECT 17, 'billing_webhook_ingress_stage_catalog', 'billing-webhook-ingress-stage-catalog-v1'
WHERE NOT EXISTS (
    SELECT 1 FROM athena_billing_migrations WHERE version = 17
);
