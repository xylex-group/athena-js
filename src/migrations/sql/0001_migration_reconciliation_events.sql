CREATE TABLE IF NOT EXISTS athena.schema_migration_reconciliation_events (
  id uuid PRIMARY KEY,
  version BIGINT NOT NULL,
  classification text NOT NULL,
  confidence text NOT NULL,
  old_checksum text,
  proposed_checksum text,
  action text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  repository_commit text,
  physical_fingerprint text,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  runner_version text
);
