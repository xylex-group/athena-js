-- Durable ingress failure machine: retryable vs terminal, lease, next attempt.
-- Do not store webhook payloads or signing secrets in error jsonb.

ALTER TABLE athena.event_ingress
    ADD COLUMN IF NOT EXISTS failure_stage text;

ALTER TABLE athena.event_ingress
    ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz;

ALTER TABLE athena.event_ingress
    ADD COLUMN IF NOT EXISTS lease_owner text;

ALTER TABLE athena.event_ingress
    ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz;

ALTER TABLE athena.event_ingress
    ADD COLUMN IF NOT EXISTS first_failed_at timestamptz;

ALTER TABLE athena.event_ingress
    ADD COLUMN IF NOT EXISTS last_failed_at timestamptz;

ALTER TABLE athena.event_ingress
    DROP CONSTRAINT IF EXISTS event_ingress_status_check;

ALTER TABLE athena.event_ingress
    ADD CONSTRAINT event_ingress_status_check CHECK (
        status IN (
            'received',
            'resolving',
            'processed',
            'ignored',
            'retryable_failure',
            'terminal_failure'
        )
    );

CREATE INDEX IF NOT EXISTS idx_event_ingress_retryable
    ON athena.event_ingress (next_attempt_at)
    WHERE status = 'retryable_failure';

CREATE INDEX IF NOT EXISTS idx_event_ingress_stuck_resolving
    ON athena.event_ingress (received_at)
    WHERE status = 'resolving';

INSERT INTO athena_event_ingress_migrations (version, name, checksum)
SELECT 2, 'event_ingress_failure_machine', 'event-ingress-failure-machine-v1'
WHERE NOT EXISTS (
    SELECT 1 FROM athena_event_ingress_migrations WHERE version = 2
);
