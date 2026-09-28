-- Billing customer importer state, runs, and candidate audit.
-- Email is never an ownership key. Apply after 0003 (uuid connection_id).

CREATE TABLE IF NOT EXISTS billing.billing_import_state (
    connection_id uuid NOT NULL REFERENCES billing.billing_provider_connections (id),
    resource_kind text NOT NULL,
    cursor text,
    last_started_at timestamptz,
    last_completed_at timestamptz,
    last_success_at timestamptz,
    last_error text,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (connection_id, resource_kind),
    CONSTRAINT billing_import_state_resource_kind_check CHECK (
        resource_kind IN ('customers')
    )
);

CREATE TABLE IF NOT EXISTS billing.billing_import_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    connection_id uuid NOT NULL REFERENCES billing.billing_provider_connections (id),
    provider text NOT NULL,
    started_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    status text NOT NULL,
    customers_scanned integer NOT NULL DEFAULT 0,
    bindings_created integer NOT NULL DEFAULT 0,
    bindings_activated integer NOT NULL DEFAULT 0,
    conflicts integer NOT NULL DEFAULT 0,
    skipped integer NOT NULL DEFAULT 0,
    errors integer NOT NULL DEFAULT 0,
    cursor_before text,
    cursor_after text,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    CONSTRAINT billing_import_runs_status_check CHECK (
        status IN ('running', 'completed', 'failed', 'dry_run')
    )
);

CREATE INDEX IF NOT EXISTS idx_billing_import_runs_connection ON billing.billing_import_runs (connection_id, started_at DESC);

CREATE TABLE IF NOT EXISTS billing.billing_import_candidates (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    import_run_id uuid NOT NULL REFERENCES billing.billing_import_runs (id),
    connection_id uuid NOT NULL REFERENCES billing.billing_provider_connections (id),
    provider_customer_id text NOT NULL,
    subject_kind text,
    subject_id text,
    confidence text NOT NULL,
    decision text NOT NULL,
    evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
    reason text,
    created_at timestamptz NOT NULL DEFAULT now (),
    resolved_at timestamptz,
    CONSTRAINT billing_import_candidates_confidence_check CHECK (
        confidence IN ('exact', 'strong', 'ambiguous', 'none')
    ),
    CONSTRAINT billing_import_candidates_decision_check CHECK (
        decision IN ('bind', 'skip', 'conflict', 'manual_review')
    )
);

CREATE INDEX IF NOT EXISTS idx_billing_import_candidates_run ON billing.billing_import_candidates (import_run_id);

INSERT INTO athena_billing_migrations (version, name, checksum)
SELECT 4, 'billing_customer_import', 'billing-customer-import-v1'
WHERE NOT EXISTS (
    SELECT 1 FROM athena_billing_migrations WHERE version = 4
);
