-- Billing subject isolation finality.
-- Idempotent on databases that already applied 0001/0002 (tables exist, ledger empty).
-- Canonical owner mapping is billing.billing_subject_bindings, not connection owner_*.

CREATE SCHEMA IF NOT EXISTS billing;

CREATE TABLE IF NOT EXISTS athena_billing_migrations (
  version integer PRIMARY KEY,
  name text NOT NULL,
  checksum text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);

-- Reconcile ledger when physical 0001/0002 objects exist without rows.
INSERT INTO athena_billing_migrations (version, name, checksum)
SELECT 1, 'billing_canonical', 'billing-canonical-v1'
WHERE EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'billing'
      AND table_name = 'billing_payments'
)
  AND NOT EXISTS (
    SELECT 1 FROM athena_billing_migrations WHERE version = 1
);

INSERT INTO athena_billing_migrations (version, name, checksum)
SELECT 2, 'billing_subject_bindings', 'billing-subject-bindings-v1'
WHERE EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'billing'
      AND table_name = 'billing_subject_bindings'
)
  AND NOT EXISTS (
    SELECT 1 FROM athena_billing_migrations WHERE version = 2
);

CREATE TABLE IF NOT EXISTS billing.billing_provider_connections (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_kind text NOT NULL,
    owner_id text NOT NULL,
    provider text NOT NULL,
    mode text NOT NULL DEFAULT 'live',
    environment text NOT NULL DEFAULT 'live',
    status text NOT NULL DEFAULT 'pending',
    credential_kind text NOT NULL DEFAULT 'api_key',
    provider_account_id text NOT NULL,
    account_reference text NOT NULL,
    provider_profile_id text,
    scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
    config jsonb NOT NULL DEFAULT '{}'::jsonb,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    CONSTRAINT billing_provider_connections_owner_kind_check CHECK (
        owner_kind IN ('user', 'organization', 'org', 'workspace', 'tenant')
    ),
    CONSTRAINT billing_provider_connections_provider_check CHECK (
        btrim(provider) <> ''
    ),
    CONSTRAINT billing_provider_connections_mode_check CHECK (
        mode IN ('live', 'test')
    ),
    CONSTRAINT billing_provider_connections_environment_check CHECK (
        environment IN ('live', 'test')
    ),
    CONSTRAINT billing_provider_connections_status_check CHECK (
        status IN ('pending', 'active', 'disabled', 'error')
    ),
    CONSTRAINT billing_provider_connections_credential_kind_check CHECK (
        credential_kind IN (
            'api_key',
            'advanced_access_token',
            'organization_access_token',
            'oauth_access_token',
            'secret_key',
            'restricted_key'
        )
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_provider_connections_identity
    ON billing.billing_provider_connections (provider, account_reference, environment)
    WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS billing.billing_webhook_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    connection_id uuid NOT NULL REFERENCES billing.billing_provider_connections(id) ON DELETE CASCADE,
    provider text NOT NULL,
    envelope_kind text NOT NULL DEFAULT 'classic',
    verification_mode text NOT NULL DEFAULT 'signature',
    signature_header_name text,
    event_id text,
    event_type text,
    resource text,
    entity_id text,
    document_kind text NOT NULL,
    provider_ref text NOT NULL,
    signature_headers jsonb NOT NULL DEFAULT '[]'::jsonb,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    summary jsonb NOT NULL DEFAULT '{}'::jsonb,
    received_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT billing_webhook_events_provider_check CHECK (btrim(provider) <> ''),
    CONSTRAINT billing_webhook_events_document_kind_check CHECK (
        document_kind IN ('payment', 'subscription', 'invoice')
    )
);

CREATE INDEX IF NOT EXISTS idx_billing_webhook_events_connection_received_at
    ON billing.billing_webhook_events (connection_id, received_at DESC);

CREATE TABLE IF NOT EXISTS billing.billing_projection_events (
    billing_projection_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    webhook_sink_event_id uuid,
    connection_id uuid REFERENCES billing.billing_provider_connections(id) ON DELETE SET NULL,
    provider text NOT NULL,
    event_type text,
    verification_status text NOT NULL DEFAULT 'verification_pending',
    projection_status text NOT NULL DEFAULT 'received',
    canonical_document_kind text,
    canonical_document_id uuid,
    adapter_name text NOT NULL DEFAULT 'embedded',
    attempt_count integer NOT NULL DEFAULT 0,
    received_at timestamptz NOT NULL DEFAULT now(),
    projected_at timestamptz,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    last_error jsonb,
    CONSTRAINT billing_projection_events_provider_nonempty CHECK (btrim(provider) <> ''),
    CONSTRAINT billing_projection_events_verification_status_valid CHECK (
        verification_status IN ('received', 'verification_pending', 'verified', 'rejected')
    ),
    CONSTRAINT billing_projection_events_projection_status_valid CHECK (
        projection_status IN ('received', 'decoded', 'projected', 'ignored', 'failed')
    )
);

CREATE INDEX IF NOT EXISTS idx_billing_projection_events_received
    ON billing.billing_projection_events (received_at DESC);

-- Existing 0003 installs may still have the closed provider CHECK.
ALTER TABLE billing.billing_provider_connections
    DROP CONSTRAINT IF EXISTS billing_provider_connections_provider_check;
ALTER TABLE billing.billing_provider_connections
    ADD CONSTRAINT billing_provider_connections_provider_check CHECK (btrim(provider) <> '');

ALTER TABLE billing.billing_webhook_events
    DROP CONSTRAINT IF EXISTS billing_webhook_events_provider_check;
ALTER TABLE billing.billing_webhook_events
    ADD CONSTRAINT billing_webhook_events_provider_check CHECK (btrim(provider) <> '');

ALTER TABLE billing.billing_payments
    DROP CONSTRAINT IF EXISTS billing_payments_provider_check;
ALTER TABLE billing.billing_payments
    DROP CONSTRAINT IF EXISTS billing_payments_provider_nonempty;
ALTER TABLE billing.billing_payments
    ADD CONSTRAINT billing_payments_provider_nonempty CHECK (btrim(provider) <> '');

ALTER TABLE billing.billing_subscriptions
    DROP CONSTRAINT IF EXISTS billing_subscriptions_provider_check;
ALTER TABLE billing.billing_subscriptions
    DROP CONSTRAINT IF EXISTS billing_subscriptions_provider_nonempty;
ALTER TABLE billing.billing_subscriptions
    ADD CONSTRAINT billing_subscriptions_provider_nonempty CHECK (btrim(provider) <> '');

ALTER TABLE billing.billing_invoices
    DROP CONSTRAINT IF EXISTS billing_invoices_provider_check;
ALTER TABLE billing.billing_invoices
    DROP CONSTRAINT IF EXISTS billing_invoices_provider_nonempty;
ALTER TABLE billing.billing_invoices
    ADD CONSTRAINT billing_invoices_provider_nonempty CHECK (btrim(provider) <> '');

-- Map logical connection ids (default, mollie-live, …) to UUIDs before the type change.
-- Never CAST text connection_id to uuid. Ambiguous collisions fail closed.
DROP INDEX IF EXISTS billing.idx_billing_payments_connection_provider_payment;
DROP INDEX IF EXISTS billing.idx_billing_subscriptions_connection_provider_subscription;
DROP INDEX IF EXISTS billing.idx_billing_invoices_connection_provider_invoice;

DO $$
DECLARE
    bindings_type text;
    hashed_uuid uuid;
    legacy text;
BEGIN
    SELECT c.data_type
    INTO bindings_type
    FROM information_schema.columns c
    WHERE c.table_schema = 'billing'
      AND c.table_name = 'billing_subject_bindings'
      AND c.column_name = 'connection_id';

    IF bindings_type IS NULL THEN
        RAISE EXCEPTION 'billing 0003: billing_subject_bindings.connection_id is missing';
    END IF;

    IF bindings_type = 'uuid' THEN
        RETURN;
    END IF;

    CREATE TEMP TABLE billing_connection_upgrade (
        legacy_id text PRIMARY KEY,
        connection_uuid uuid NOT NULL
    ) ON COMMIT DROP;

    INSERT INTO billing_connection_upgrade (legacy_id, connection_uuid)
    SELECT DISTINCT src.legacy_id, src.legacy_id::uuid
    FROM (
        SELECT connection_id AS legacy_id FROM billing.billing_subject_bindings
        UNION
        SELECT connection_id FROM billing.billing_payments WHERE connection_id IS NOT NULL AND btrim(connection_id) <> ''
        UNION
        SELECT connection_id FROM billing.billing_subscriptions WHERE connection_id IS NOT NULL AND btrim(connection_id) <> ''
        UNION
        SELECT connection_id FROM billing.billing_invoices WHERE connection_id IS NOT NULL AND btrim(connection_id) <> ''
    ) src
    WHERE src.legacy_id IS NOT NULL
      AND src.legacy_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';

    FOR legacy IN
        SELECT DISTINCT src.legacy_id
        FROM (
            SELECT connection_id AS legacy_id FROM billing.billing_subject_bindings
            UNION
            SELECT connection_id FROM billing.billing_payments WHERE connection_id IS NOT NULL AND btrim(connection_id) <> ''
            UNION
            SELECT connection_id FROM billing.billing_subscriptions WHERE connection_id IS NOT NULL AND btrim(connection_id) <> ''
            UNION
            SELECT connection_id FROM billing.billing_invoices WHERE connection_id IS NOT NULL AND btrim(connection_id) <> ''
        ) src
        WHERE src.legacy_id IS NOT NULL
          AND btrim(src.legacy_id) <> ''
          AND src.legacy_id !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    LOOP
        hashed_uuid := (
            'x' || substr(md5('athena.billing.connection:' || legacy), 1, 32)
        )::uuid;
        IF EXISTS (
            SELECT 1 FROM billing_connection_upgrade u
            WHERE u.connection_uuid = hashed_uuid
        ) THEN
            RAISE EXCEPTION 'billing 0003: connection_id mapping is ambiguous for %', legacy;
        END IF;
        INSERT INTO billing_connection_upgrade (legacy_id, connection_uuid)
        VALUES (legacy, hashed_uuid);
    END LOOP;

    IF EXISTS (
        SELECT 1
        FROM billing_connection_upgrade
        GROUP BY connection_uuid
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'billing 0003: connection_id mapping is ambiguous';
    END IF;

    INSERT INTO billing.billing_provider_connections (
        id,
        owner_kind,
        owner_id,
        provider,
        mode,
        environment,
        status,
        credential_kind,
        provider_account_id,
        account_reference,
        scopes,
        config,
        metadata
    )
    SELECT
        u.connection_uuid,
        'tenant',
        'legacy-upgrade',
        'legacy',
        'live',
        'live',
        'pending',
        'api_key',
        u.legacy_id,
        u.legacy_id,
        '[]'::jsonb,
        '{}'::jsonb,
        jsonb_build_object('legacyConnectionId', u.legacy_id)
    FROM billing_connection_upgrade u
    ON CONFLICT (id) DO NOTHING;

    ALTER TABLE billing.billing_subject_bindings
        ADD COLUMN IF NOT EXISTS connection_id_uuid uuid;
    ALTER TABLE billing.billing_payments
        ADD COLUMN IF NOT EXISTS connection_id_uuid uuid;
    ALTER TABLE billing.billing_subscriptions
        ADD COLUMN IF NOT EXISTS connection_id_uuid uuid;
    ALTER TABLE billing.billing_invoices
        ADD COLUMN IF NOT EXISTS connection_id_uuid uuid;

    UPDATE billing.billing_subject_bindings b
    SET connection_id_uuid = u.connection_uuid
    FROM billing_connection_upgrade u
    WHERE b.connection_id = u.legacy_id;

    UPDATE billing.billing_payments p
    SET connection_id_uuid = u.connection_uuid
    FROM billing_connection_upgrade u
    WHERE p.connection_id = u.legacy_id;

    UPDATE billing.billing_subscriptions s
    SET connection_id_uuid = u.connection_uuid
    FROM billing_connection_upgrade u
    WHERE s.connection_id = u.legacy_id;

    UPDATE billing.billing_invoices i
    SET connection_id_uuid = u.connection_uuid
    FROM billing_connection_upgrade u
    WHERE i.connection_id = u.legacy_id;

    IF EXISTS (
        SELECT 1 FROM billing.billing_subject_bindings
        WHERE connection_id_uuid IS NULL
    ) THEN
        RAISE EXCEPTION 'billing 0003: unresolved subject binding connection_id';
    END IF;

    ALTER TABLE billing.billing_subject_bindings DROP COLUMN connection_id;
    ALTER TABLE billing.billing_subject_bindings RENAME COLUMN connection_id_uuid TO connection_id;
    ALTER TABLE billing.billing_subject_bindings ALTER COLUMN connection_id SET NOT NULL;

    ALTER TABLE billing.billing_payments DROP COLUMN connection_id;
    ALTER TABLE billing.billing_payments RENAME COLUMN connection_id_uuid TO connection_id;

    ALTER TABLE billing.billing_subscriptions DROP COLUMN connection_id;
    ALTER TABLE billing.billing_subscriptions RENAME COLUMN connection_id_uuid TO connection_id;

    ALTER TABLE billing.billing_invoices DROP COLUMN connection_id;
    ALTER TABLE billing.billing_invoices RENAME COLUMN connection_id_uuid TO connection_id;
END $$;

ALTER TABLE billing.billing_subject_bindings
    DROP CONSTRAINT IF EXISTS billing_subject_bindings_connection_id_fkey;

ALTER TABLE billing.billing_subject_bindings
    ADD CONSTRAINT billing_subject_bindings_connection_id_fkey
    FOREIGN KEY (connection_id) REFERENCES billing.billing_provider_connections(id)
    ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_subject_bindings_provider_locator
    ON billing.billing_subject_bindings (
        connection_id,
        provider_subject_kind,
        provider_subject_id
    );

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_subject_bindings_one_primary
    ON billing.billing_subject_bindings (
        connection_id,
        subject_kind,
        subject_id,
        provider_subject_kind
    )
    WHERE status = 'active' AND is_primary;

CREATE INDEX IF NOT EXISTS idx_billing_subject_bindings_subject
    ON billing.billing_subject_bindings (
        subject_kind,
        subject_id,
        connection_id
    );

-- Resolved ownership requires a connection and Athena subject.
ALTER TABLE billing.billing_payments
    DROP CONSTRAINT IF EXISTS billing_payments_resolved_ownership_check;

ALTER TABLE billing.billing_payments
    ADD CONSTRAINT billing_payments_resolved_ownership_check CHECK (
        ownership_status <> 'resolved'
        OR (
            connection_id IS NOT NULL
            AND subject_kind IS NOT NULL
            AND subject_id IS NOT NULL
        )
    );

ALTER TABLE billing.billing_subscriptions
    DROP CONSTRAINT IF EXISTS billing_subscriptions_resolved_ownership_check;

ALTER TABLE billing.billing_subscriptions
    ADD CONSTRAINT billing_subscriptions_resolved_ownership_check CHECK (
        ownership_status <> 'resolved'
        OR (
            connection_id IS NOT NULL
            AND subject_kind IS NOT NULL
            AND subject_id IS NOT NULL
        )
    );

ALTER TABLE billing.billing_invoices
    DROP CONSTRAINT IF EXISTS billing_invoices_resolved_ownership_check;

ALTER TABLE billing.billing_invoices
    ADD CONSTRAINT billing_invoices_resolved_ownership_check CHECK (
        ownership_status <> 'resolved'
        OR (
            connection_id IS NOT NULL
            AND subject_kind IS NOT NULL
            AND subject_id IS NOT NULL
        )
    );

CREATE INDEX IF NOT EXISTS idx_billing_payments_subject_resolved
    ON billing.billing_payments (subject_kind, subject_id)
    WHERE ownership_status = 'resolved';

CREATE INDEX IF NOT EXISTS idx_billing_subscriptions_subject_resolved
    ON billing.billing_subscriptions (subject_kind, subject_id)
    WHERE ownership_status = 'resolved';

CREATE INDEX IF NOT EXISTS idx_billing_invoices_subject_resolved
    ON billing.billing_invoices (subject_kind, subject_id)
    WHERE ownership_status = 'resolved';

-- Connection-scoped uniqueness (replaces provider-global indexes).
CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_payments_connection_provider_payment
    ON billing.billing_payments (connection_id, provider_payment_id)
    WHERE connection_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_subscriptions_connection_provider_subscription
    ON billing.billing_subscriptions (connection_id, provider_subscription_id)
    WHERE connection_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_invoices_connection_provider_invoice
    ON billing.billing_invoices (connection_id, provider_invoice_id)
    WHERE connection_id IS NOT NULL;

-- Supersede provider-global uniqueness from 0001/0002.
DROP INDEX IF EXISTS billing.idx_billing_payments_provider_payment_id;
DROP INDEX IF EXISTS billing.idx_billing_subscriptions_provider_subscription_id;
DROP INDEX IF EXISTS billing.idx_billing_invoices_provider_invoice_id;

INSERT INTO athena_billing_migrations (version, name, checksum)
SELECT 3, 'billing_subject_finality', 'billing-subject-finality-v2'
WHERE NOT EXISTS (
    SELECT 1 FROM athena_billing_migrations WHERE version = 3
);
