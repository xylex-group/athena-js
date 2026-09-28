-- One unresolved ownership conflict has exactly one open canonical row.
-- Repeated reconciliation must observe that row, not append duplicates.

ALTER TABLE billing.billing_binding_conflicts
    ADD COLUMN IF NOT EXISTS last_observed_at timestamptz,
    ADD COLUMN IF NOT EXISTS observation_count integer NOT NULL DEFAULT 1;

UPDATE billing.billing_binding_conflicts
SET last_observed_at = created_at
WHERE last_observed_at IS NULL;

ALTER TABLE billing.billing_binding_conflicts
    ALTER COLUMN last_observed_at SET DEFAULT now(),
    ALTER COLUMN last_observed_at SET NOT NULL;

ALTER TABLE billing.billing_binding_conflicts
    ADD COLUMN IF NOT EXISTS identity_subject_kind text
        GENERATED ALWAYS AS (COALESCE(subject_kind, '')) STORED,
    ADD COLUMN IF NOT EXISTS identity_subject_id text
        GENERATED ALWAYS AS (COALESCE(subject_id, '')) STORED;

ALTER TABLE billing.billing_binding_conflicts
    DROP CONSTRAINT IF EXISTS billing_binding_conflicts_observation_count_check;

ALTER TABLE billing.billing_binding_conflicts
    ADD CONSTRAINT billing_binding_conflicts_observation_count_check
    CHECK (observation_count >= 1);

WITH groups AS (
    SELECT
        connection_id,
        candidate_provider_customer_id,
        COALESCE(subject_kind, '') AS identity_kind,
        COALESCE(subject_id, '') AS identity_id,
        (ARRAY_AGG(id ORDER BY created_at ASC, id ASC))[1] AS keep_id,
        COUNT(*)::int AS observation_n,
        MAX(created_at) AS last_at
    FROM billing.billing_binding_conflicts
    WHERE status = 'open'
    GROUP BY
        connection_id,
        candidate_provider_customer_id,
        COALESCE(subject_kind, ''),
        COALESCE(subject_id, '')
)
UPDATE billing.billing_binding_conflicts AS canonical
SET
    observation_count = groups.observation_n,
    last_observed_at = groups.last_at
FROM groups
WHERE canonical.id = groups.keep_id;

WITH groups AS (
    SELECT
        connection_id,
        candidate_provider_customer_id,
        COALESCE(subject_kind, '') AS identity_kind,
        COALESCE(subject_id, '') AS identity_id,
        (ARRAY_AGG(id ORDER BY created_at ASC, id ASC))[1] AS keep_id
    FROM billing.billing_binding_conflicts
    WHERE status = 'open'
    GROUP BY
        connection_id,
        candidate_provider_customer_id,
        COALESCE(subject_kind, ''),
        COALESCE(subject_id, '')
)
UPDATE billing.billing_binding_conflicts AS duplicate
SET
    status = 'resolved',
    resolved_at = now(),
    resolved_by = 'system:conflict-deduplication'
FROM groups
WHERE duplicate.status = 'open'
  AND duplicate.id <> groups.keep_id
  AND duplicate.connection_id = groups.connection_id
  AND duplicate.candidate_provider_customer_id = groups.candidate_provider_customer_id
  AND COALESCE(duplicate.subject_kind, '') = groups.identity_kind
  AND COALESCE(duplicate.subject_id, '') = groups.identity_id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_billing_binding_conflicts_open_identity
    ON billing.billing_binding_conflicts (
        connection_id,
        candidate_provider_customer_id,
        identity_subject_kind,
        identity_subject_id
    )
    WHERE status = 'open';

INSERT INTO athena_billing_migrations (version, name, checksum)
SELECT 36, 'billing_binding_conflict_identity', 'billing-binding-conflict-identity-v1'
WHERE NOT EXISTS (
    SELECT 1 FROM athena_billing_migrations WHERE version = 36
);
