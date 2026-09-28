CREATE TABLE IF NOT EXISTS billing.billing_binding_conflicts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_kind text CHECK (subject_kind IN ('user', 'organization')),
    subject_id text,
    connection_id uuid NOT NULL REFERENCES billing.billing_provider_connections(id) ON DELETE CASCADE,
    candidate_provider_customer_id text NOT NULL,
    reason text NOT NULL CHECK (reason IN (
        'multiple_email_matches',
        'existing_active_binding',
        'provider_customer_claimed',
        'identity_changed',
        'ambiguous_import',
        'manual_review_required'
    )),
    confidence text NOT NULL DEFAULT 'none',
    status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
    created_at timestamptz NOT NULL DEFAULT now(),
    resolved_at timestamptz,
    resolved_by text
);

CREATE INDEX IF NOT EXISTS idx_billing_binding_conflicts_open
    ON billing.billing_binding_conflicts (connection_id, status)
    WHERE status = 'open';

INSERT INTO athena_billing_migrations (version, name, checksum)
SELECT 20, 'billing_binding_conflicts', 'billing-binding-conflicts-v1'
WHERE NOT EXISTS (
    SELECT 1 FROM athena_billing_migrations WHERE version = 20
);
