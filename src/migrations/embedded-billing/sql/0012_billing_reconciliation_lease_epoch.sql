ALTER TABLE billing.billing_reconciliation_leases
    ADD COLUMN IF NOT EXISTS epoch bigint NOT NULL DEFAULT 0;

INSERT INTO athena_billing_migrations (version, name, checksum)
SELECT 12, 'billing_reconciliation_lease_epoch', 'billing-reconciliation-lease-epoch-v1'
WHERE NOT EXISTS (
    SELECT 1 FROM athena_billing_migrations WHERE version = 12
);
