-- Persist the ingest channel (classic vs next-gen). Replay must not infer
-- operation from the body.

ALTER TABLE athena.event_ingress
    ADD COLUMN IF NOT EXISTS operation text;

UPDATE athena.event_ingress
SET operation = headers->>'x-athena-ingress-operation'
WHERE operation IS NULL
  AND headers ? 'x-athena-ingress-operation'
  AND length(trim(headers->>'x-athena-ingress-operation')) > 0;

INSERT INTO athena_event_ingress_migrations (version, name, checksum)
SELECT 3, 'event_ingress_operation_channel', 'event-ingress-operation-channel-v1'
WHERE NOT EXISTS (
    SELECT 1 FROM athena_event_ingress_migrations WHERE version = 3
);
