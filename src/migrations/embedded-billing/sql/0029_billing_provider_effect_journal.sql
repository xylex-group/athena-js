-- Durable provider effects for plan-change and future Billing mutations.

ALTER TABLE billing.billing_plan_change_operations
    ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS next_retry_at timestamptz,
    ADD COLUMN IF NOT EXISTS last_outcome text;

ALTER TABLE billing.billing_plan_change_operations
    DROP CONSTRAINT IF EXISTS billing_plan_change_operations_state_check;

ALTER TABLE billing.billing_plan_change_operations
    ADD CONSTRAINT billing_plan_change_operations_state_check CHECK (
        state IN (
            'requested',
            'claimed',
            'provider_update_pending',
            'provider_update_unknown',
            'provider_update_applied',
            'replacement_create_pending',
            'replacement_create_unknown',
            'replacement_created',
            'old_cancel_pending',
            'old_cancel_unknown',
            'old_cancelled',
            'local_commit_pending',
            'compensating',
            'compensation_pending',
            'compensation_unknown',
            'compensation_applied',
            'completed',
            'attention_required',
            'failed'
        )
    );

CREATE TABLE IF NOT EXISTS billing.billing_provider_effects (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    operation_id uuid NOT NULL,
    effect_type text NOT NULL,
    provider text NOT NULL,
    connection_id uuid NOT NULL REFERENCES billing.billing_provider_connections (id),
    idempotency_key text NOT NULL,
    state text NOT NULL CHECK (
        state IN ('pending', 'claimed', 'applied', 'unknown', 'failed', 'attention_required')
    ),
    attempts integer NOT NULL DEFAULT 0,
    provider_resource_id text,
    request_fingerprint text NOT NULL,
    observed_result jsonb,
    observed_evidence jsonb,
    lease_token text,
    lease_expires_at timestamptz,
    fencing_epoch integer NOT NULL DEFAULT 0,
    last_error text,
    claimed_at timestamptz,
    completed_at timestamptz,
    unknown_at timestamptz,
    failed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now (),
    updated_at timestamptz NOT NULL DEFAULT now (),
    UNIQUE (operation_id, effect_type)
);

CREATE INDEX IF NOT EXISTS billing_provider_effects_operation_idx
    ON billing.billing_provider_effects (operation_id);

CREATE INDEX IF NOT EXISTS billing_provider_effects_claim_idx
    ON billing.billing_provider_effects (state, lease_expires_at);

INSERT INTO athena_billing_migrations (version, name, checksum)
SELECT 29, 'billing_provider_effect_journal', 'billing-provider-effect-journal-v1'
WHERE NOT EXISTS (
    SELECT 1 FROM athena_billing_migrations WHERE version = 29
);
