-- Declared connection identity: one non-deleted row per
-- (owner_id, provider, environment, credential_reference).
-- Historical leftovers in another environment stay stored as independent
-- (disabled) rows; they must not share this unique slot.

WITH
    ranked AS (
        SELECT id, row_number() OVER (
                PARTITION BY owner_id, provider, environment, credential_reference
                ORDER BY
                    CASE
                        WHEN status = 'active' THEN 0
                        ELSE 1
                    END, updated_at DESC, created_at DESC
            ) AS rn
        FROM billing.billing_provider_connections
        WHERE
            deleted_at IS NULL
    )
UPDATE billing.billing_provider_connections AS connections
SET
    deleted_at = now(),
    status = 'disabled',
    updated_at = now()
FROM ranked
WHERE
    connections.id = ranked.id
    AND ranked.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_provider_connections_declared_slot ON billing.billing_provider_connections (
    owner_id,
    provider,
    environment,
    credential_reference
)
WHERE
    deleted_at IS NULL;

INSERT INTO
    athena_billing_migrations (version, name, checksum)
SELECT 14, 'billing_connection_declared_slot', 'billing-connection-declared-slot-v1'
WHERE
    NOT EXISTS (
        SELECT 1
        FROM athena_billing_migrations
        WHERE
            version = 14
    );