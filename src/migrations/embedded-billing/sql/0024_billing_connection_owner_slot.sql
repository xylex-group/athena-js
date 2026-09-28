-- Owner-scoped declared slot: (owner_kind, owner_id, provider, environment, credential_reference).
-- Does not rewrite applied 0014. Ambiguous duplicates are disabled with an audit note.

WITH ranked AS (
    SELECT id,
        owner_kind,
        owner_id,
        provider,
        environment,
        credential_reference,
        row_number() OVER (
            PARTITION BY owner_kind, owner_id, provider, environment, credential_reference
            ORDER BY
                CASE WHEN status = 'active' THEN 0 ELSE 1 END,
                updated_at DESC,
                created_at DESC
        ) AS rn
    FROM billing.billing_provider_connections
    WHERE deleted_at IS NULL
)
UPDATE billing.billing_provider_connections AS connections
SET deleted_at = now(),
    status = 'disabled',
    updated_at = now(),
    metadata = COALESCE(metadata, '{}'::jsonb)
        || jsonb_build_object('duplicateSlotRemediation', '0024')
FROM ranked
WHERE connections.id = ranked.id
  AND ranked.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_provider_connections_owner_slot
ON billing.billing_provider_connections (
    owner_kind,
    owner_id,
    provider,
    environment,
    credential_reference
)
WHERE deleted_at IS NULL;

INSERT INTO athena_billing_migrations (version, name, checksum)
SELECT 24, 'billing_connection_owner_slot', 'billing-connection-owner-slot-v1'
WHERE NOT EXISTS (
    SELECT 1 FROM athena_billing_migrations WHERE version = 24
);
