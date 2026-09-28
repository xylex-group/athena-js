-- Billing reconciliation observability: traces, semantic audit, leases, run causality.
-- Apply after 0004.

CREATE SCHEMA IF NOT EXISTS athena;

CREATE TABLE IF NOT EXISTS athena.traces_billing (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    trace_id text NOT NULL,
    correlation_id text,
    causation_id text,
    operation text NOT NULL,
    trigger text NOT NULL,
    connection_id uuid,
    provider text,
    outcome text NOT NULL,
    error_code text,
    error_phase text,
    lease_ms double precision,
    provider_ms double precision,
    resolve_ms double precision,
    transaction_ms double precision,
    projection_ms double precision,
    checkpoint_ms double precision,
    total_ms double precision NOT NULL,
    pages_processed integer NOT NULL DEFAULT 0,
    customers_scanned integer NOT NULL DEFAULT 0,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    started_at timestamptz NOT NULL,
    completed_at timestamptz NOT NULL,
    CONSTRAINT traces_billing_outcome_check CHECK (outcome IN ('success', 'failure')),
    CONSTRAINT traces_billing_trigger_check CHECK (
        trigger IN ('bootstrap', 'scheduled', 'manual', 'webhook')
    )
);

CREATE INDEX IF NOT EXISTS traces_billing_trace_id_idx
    ON athena.traces_billing (trace_id);

CREATE INDEX IF NOT EXISTS traces_billing_correlation_id_idx
    ON athena.traces_billing (correlation_id);

CREATE INDEX IF NOT EXISTS traces_billing_connection_started_at_idx
    ON athena.traces_billing (connection_id, started_at DESC);

CREATE TABLE IF NOT EXISTS athena.audit_log_billing (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    event_id text NOT NULL,
    trace_id text NOT NULL,
    correlation_id text,
    causation_id text,
    event text NOT NULL,
    actor_kind text NOT NULL,
    actor_user_id text,
    connection_id uuid,
    provider text,
    subject_kind text,
    subject_id text,
    provider_subject_kind text,
    provider_subject_id text,
    previous jsonb,
    result jsonb,
    outcome text NOT NULL DEFAULT 'success',
    created_at timestamptz NOT NULL DEFAULT now (),
    CONSTRAINT audit_log_billing_outcome_check CHECK (outcome = 'success'),
    CONSTRAINT audit_log_billing_actor_kind_check CHECK (
        actor_kind IN ('system', 'user', 'service')
    )
);

CREATE INDEX IF NOT EXISTS audit_log_billing_trace_id_idx
    ON athena.audit_log_billing (trace_id);

CREATE INDEX IF NOT EXISTS audit_log_billing_connection_created_at_idx
    ON athena.audit_log_billing (connection_id, created_at DESC);

CREATE TABLE IF NOT EXISTS billing.billing_reconciliation_leases (
    connection_id uuid NOT NULL REFERENCES billing.billing_provider_connections (id),
    resource_kind text NOT NULL,
    owner_id text NOT NULL,
    acquired_at timestamptz NOT NULL,
    heartbeat_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    PRIMARY KEY (connection_id, resource_kind),
    CONSTRAINT billing_reconciliation_leases_resource_kind_check CHECK (
        resource_kind IN ('customers')
    )
);

ALTER TABLE billing.billing_import_runs
    ADD COLUMN IF NOT EXISTS trace_id text,
    ADD COLUMN IF NOT EXISTS correlation_id text,
    ADD COLUMN IF NOT EXISTS causation_id text,
    ADD COLUMN IF NOT EXISTS trigger text,
    ADD COLUMN IF NOT EXISTS resource_kind text NOT NULL DEFAULT 'customers',
    ADD COLUMN IF NOT EXISTS pages_processed integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS has_more boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS attempt integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS heartbeat_at timestamptz,
    ADD COLUMN IF NOT EXISTS error_code text,
    ADD COLUMN IF NOT EXISTS error_phase text;

ALTER TABLE billing.billing_import_runs
    DROP CONSTRAINT IF EXISTS billing_import_runs_status_check;

ALTER TABLE billing.billing_import_runs
    ADD CONSTRAINT billing_import_runs_status_check CHECK (
        status IN (
            'queued',
            'running',
            'checkpointed',
            'completed',
            'completed_with_conflicts',
            'failed',
            'cancelled',
            'dry_run'
        )
    );

ALTER TABLE billing.billing_import_candidates
    ADD COLUMN IF NOT EXISTS trace_id text,
    ADD COLUMN IF NOT EXISTS correlation_id text,
    ADD COLUMN IF NOT EXISTS binding_id uuid;

INSERT INTO athena_billing_migrations (version, name, checksum)
SELECT 5, 'billing_reconciliation_observability', 'billing-reconciliation-observability-v1'
WHERE NOT EXISTS (
    SELECT 1 FROM athena_billing_migrations WHERE version = 5
);
