CREATE TABLE IF NOT EXISTS billing.billing_entitlements (
    subject_kind text NOT NULL CHECK (subject_kind IN ('user', 'organization')),
    subject_id text NOT NULL,
    plans jsonb NOT NULL DEFAULT '[]'::jsonb,
    features jsonb NOT NULL DEFAULT '{}'::jsonb,
    subscription_status text,
    renews_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (subject_kind, subject_id)
);

INSERT INTO athena_billing_migrations (version, name, checksum)
SELECT 19, 'billing_entitlements', 'billing-entitlements-v1'
WHERE NOT EXISTS (
    SELECT 1 FROM athena_billing_migrations WHERE version = 19
);
