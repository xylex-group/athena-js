CREATE SCHEMA IF NOT EXISTS athena;

CREATE TABLE IF NOT EXISTS athena_event_ingress_migrations (
  version integer PRIMARY KEY,
  name text NOT NULL,
  checksum text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS athena.event_ingress (
  id uuid PRIMARY KEY,
  domain text NOT NULL,
  provider text,
  provider_event_id text,
  connection_id text,
  received_at timestamptz NOT NULL,
  body bytea NOT NULL,
  headers jsonb NOT NULL,
  status text NOT NULL,
  correlation_id text,
  trace_id text,
  attempt_count integer NOT NULL DEFAULT 0,
  processed_at timestamptz,
  failed_at timestamptz,
  error jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_event_ingress_provider_event
  ON athena.event_ingress (domain, provider, provider_event_id)
  WHERE provider_event_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS athena.event_ledger (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  domain text NOT NULL,
  provider text,
  subject_type text NOT NULL,
  subject_id text NOT NULL,
  ingress_id uuid,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL,
  observed_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS athena.event_outbox (
  id uuid PRIMARY KEY,
  event_id uuid NOT NULL,
  name text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);
