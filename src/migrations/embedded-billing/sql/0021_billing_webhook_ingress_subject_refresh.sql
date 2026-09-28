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
            'subject_projection_refreshed',
            'entitlements_refreshed',
            'completed',
            'duplicate',
            'rejected',
            'failed'
        )
    );

INSERT INTO athena_billing_migrations (version, name, checksum)
SELECT 21, 'billing_webhook_ingress_subject_refresh', 'billing-webhook-ingress-subject-refresh-v1'
WHERE NOT EXISTS (
    SELECT 1 FROM athena_billing_migrations WHERE version = 21
);
