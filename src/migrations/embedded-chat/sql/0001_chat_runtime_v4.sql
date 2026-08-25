CREATE TABLE IF NOT EXISTS athena_chat_schema_migrations (
	version INTEGER PRIMARY KEY,
	name TEXT NOT NULL,
	checksum TEXT NOT NULL,
	applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE SCHEMA IF NOT EXISTS athena;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS athena.files (
    id text PRIMARY KEY,
    file_name text,
    original_name text,
    content_type text,
    mime_type text,
    extension text,
    size_bytes bigint,
    status text,
    visibility text,
    url text,
    bucket text,
    storage_key text
);

-- Prior chat self-heal may have created athena.files with only `id`.
-- CREATE TABLE IF NOT EXISTS does not add missing columns; upgrade in place
-- before recording durable schema version 4 (attachment list JOINs need these).
ALTER TABLE athena.files ADD COLUMN IF NOT EXISTS file_name text;
ALTER TABLE athena.files ADD COLUMN IF NOT EXISTS original_name text;
ALTER TABLE athena.files ADD COLUMN IF NOT EXISTS content_type text;
ALTER TABLE athena.files ADD COLUMN IF NOT EXISTS mime_type text;
ALTER TABLE athena.files ADD COLUMN IF NOT EXISTS extension text;
ALTER TABLE athena.files ADD COLUMN IF NOT EXISTS size_bytes bigint;
ALTER TABLE athena.files ADD COLUMN IF NOT EXISTS status text;
ALTER TABLE athena.files ADD COLUMN IF NOT EXISTS visibility text;
ALTER TABLE athena.files ADD COLUMN IF NOT EXISTS url text;
ALTER TABLE athena.files ADD COLUMN IF NOT EXISTS bucket text;
ALTER TABLE athena.files ADD COLUMN IF NOT EXISTS storage_key text;

CREATE TABLE IF NOT EXISTS athena.chat_rooms (
    id uuid PRIMARY KEY,
    organization_id text NOT NULL,
    kind text NOT NULL CHECK (kind IN ('dm', 'group', 'channel')),
    title text,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    archived_at timestamptz,
    last_message_id uuid,
    last_message_seq bigint NOT NULL DEFAULT 0,
    last_message_at timestamptz,
    version bigint NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_chat_rooms_org_recent_active
    ON athena.chat_rooms (organization_id, updated_at DESC)
    WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS athena.chat_direct_rooms (
    organization_id text NOT NULL,
    participant_one_id text COLLATE "C" NOT NULL,
    participant_two_id text COLLATE "C" NOT NULL,
    room_id uuid NOT NULL UNIQUE REFERENCES athena.chat_rooms(id) ON DELETE CASCADE,
    PRIMARY KEY (organization_id, participant_one_id, participant_two_id),
    CONSTRAINT chat_direct_rooms_canonical_participants
        CHECK (participant_one_id < participant_two_id)
);

CREATE TABLE IF NOT EXISTS athena.chat_room_members (
    room_id uuid NOT NULL REFERENCES athena.chat_rooms(id) ON DELETE CASCADE,
    user_id text NOT NULL,
    role text NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
    joined_at timestamptz NOT NULL DEFAULT now(),
    last_read_seq bigint NOT NULL DEFAULT 0,
    last_read_message_id uuid,
    muted boolean NOT NULL DEFAULT false,
    notification_mode text,
    hidden_at timestamptz,
    PRIMARY KEY (room_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_room_members_user_room
    ON athena.chat_room_members (user_id, room_id);

CREATE TABLE IF NOT EXISTS athena.chat_messages (
    id uuid PRIMARY KEY,
    room_id uuid NOT NULL REFERENCES athena.chat_rooms(id) ON DELETE CASCADE,
    room_seq bigint NOT NULL,
    sender_id text NOT NULL,
    client_message_id text,
    body_text text,
    body_json jsonb,
    reply_to_message_id uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    edited_at timestamptz,
    deleted_at timestamptz,
    metadata_json jsonb,
    CONSTRAINT chat_messages_room_seq_unique UNIQUE (room_id, room_seq),
    CONSTRAINT chat_messages_idempotency_unique UNIQUE (room_id, sender_id, client_message_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_room_seq_desc
    ON athena.chat_messages (room_id, room_seq DESC);

CREATE INDEX IF NOT EXISTS idx_chat_messages_room_created_desc
    ON athena.chat_messages (room_id, created_at DESC);

CREATE TABLE IF NOT EXISTS athena.chat_message_attachments (
    message_id uuid NOT NULL REFERENCES athena.chat_messages(id) ON DELETE CASCADE,
    file_id text NOT NULL REFERENCES athena.files(id) ON DELETE RESTRICT,
    ordinal integer NOT NULL,
    PRIMARY KEY (message_id, ordinal)
);

CREATE INDEX IF NOT EXISTS idx_chat_message_attachments_file
    ON athena.chat_message_attachments (file_id);

CREATE TABLE IF NOT EXISTS athena.chat_message_reactions (
    message_id uuid NOT NULL REFERENCES athena.chat_messages(id) ON DELETE CASCADE,
    user_id text NOT NULL,
    emoji text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (message_id, user_id, emoji)
);

CREATE INDEX IF NOT EXISTS idx_chat_message_reactions_lookup
    ON athena.chat_message_reactions (message_id, emoji);

CREATE TABLE IF NOT EXISTS athena.chat_outbox (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    aggregate_type text NOT NULL CHECK (aggregate_type IN ('chat_message', 'chat_room', 'read_cursor')),
    aggregate_id text NOT NULL,
    room_id uuid NOT NULL REFERENCES athena.chat_rooms(id) ON DELETE CASCADE,
    room_seq bigint,
    event_type text NOT NULL,
    payload_json jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    published_at timestamptz,
    publish_attempts integer NOT NULL DEFAULT 0,
    event_version integer NOT NULL DEFAULT 1,
    delivery_destination_id text,
    delivery_body bytea,
    delivery_status text NOT NULL DEFAULT 'not_required'
        CHECK (delivery_status IN ('not_required', 'pending', 'delivered', 'dead_lettered')),
    delivery_attempts integer NOT NULL DEFAULT 0,
    delivery_available_at timestamptz,
    delivery_last_error_code text,
    delivery_last_http_status integer,
    delivery_delivered_at timestamptz,
    delivery_failed_at timestamptz,
    delivery_lease_token uuid,
    delivery_lease_expires_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_chat_outbox_unpublished
    ON athena.chat_outbox (published_at, created_at)
    WHERE published_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_chat_outbox_room_seq
    ON athena.chat_outbox (room_id, room_seq);

CREATE INDEX IF NOT EXISTS idx_chat_outbox_http_delivery_pending
    ON athena.chat_outbox (delivery_available_at, created_at)
    WHERE delivery_status = 'pending';

CREATE TABLE IF NOT EXISTS athena.runtime_schema_versions (
    component text PRIMARY KEY,
    version integer NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO athena.runtime_schema_versions (component, version, updated_at)
VALUES ('chat_runtime', 4, now())
ON CONFLICT (component) DO UPDATE
SET version = GREATEST(athena.runtime_schema_versions.version, EXCLUDED.version),
    updated_at = now();
