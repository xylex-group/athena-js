CREATE SCHEMA IF NOT EXISTS forms;

CREATE TABLE IF NOT EXISTS forms.forms (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  title text NOT NULL DEFAULT 'Untitled Form',
  description text,
  slug text,
  schema jsonb NOT NULL DEFAULT '{}'::jsonb,
  schema_revision integer NOT NULL DEFAULT 0,
  is_published boolean NOT NULL DEFAULT false,
  api_key text,
  api_enabled boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE forms.forms
  ADD COLUMN IF NOT EXISTS schema_revision integer NOT NULL DEFAULT 0;
