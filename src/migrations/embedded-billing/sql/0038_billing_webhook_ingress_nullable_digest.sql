-- Secretless ingress rejection handling records classification and size only.
-- Keep historical migration 0037 digests, but permit new rows without a
-- secret-derived fingerprint.
ALTER TABLE billing.billing_webhook_ingress_rejections
    ALTER COLUMN digest DROP NOT NULL;

INSERT INTO athena_billing_migrations (version, name, checksum)
SELECT 38, 'billing_webhook_ingress_nullable_digest',
       'billing-webhook-ingress-nullable-digest-v1'
WHERE NOT EXISTS (
    SELECT 1 FROM athena_billing_migrations WHERE version = 38
);
