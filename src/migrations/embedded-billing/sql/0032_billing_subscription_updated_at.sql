-- Forward repair for plan-change fencing: generation 28 added row_version,
-- but the subscription timestamp used by optimistic updates was omitted.

ALTER TABLE billing.billing_subscriptions
    ADD COLUMN IF NOT EXISTS updated_at timestamptz;

UPDATE billing.billing_subscriptions
SET updated_at = COALESCE(ingested_at, created_at, now())
WHERE updated_at IS NULL;

ALTER TABLE billing.billing_subscriptions
    ALTER COLUMN updated_at SET DEFAULT now();

ALTER TABLE billing.billing_subscriptions
    ALTER COLUMN updated_at SET NOT NULL;

INSERT INTO athena_billing_migrations (version, name, checksum)
SELECT 32, 'billing_subscription_updated_at', 'billing-subscription-updated-at-v1'
WHERE NOT EXISTS (
    SELECT 1
    FROM athena_billing_migrations
    WHERE version = 32
);
