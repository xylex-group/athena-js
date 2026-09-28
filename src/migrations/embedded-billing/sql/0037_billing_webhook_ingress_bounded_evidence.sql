-- Replace durable rejected-webhook bodies with bounded evidence.
-- Historical rows receive an explicitly legacy, unkeyed SHA-256 digest because
-- the original request signing secret is unavailable during migration.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE billing.billing_webhook_ingress_rejections
    ADD COLUMN IF NOT EXISTS digest text,
    ADD COLUMN IF NOT EXISTS classification text,
    ADD COLUMN IF NOT EXISTS truncated boolean NOT NULL DEFAULT false;

UPDATE billing.billing_webhook_ingress_rejections
SET
    digest = encode(digest(convert_to(attempted_body, 'UTF8'), 'sha256'), 'hex'),
    classification = CASE
        WHEN body_kind IN ('empty', 'json', 'form') THEN body_kind
        ELSE 'invalid'
    END,
    truncated = false
WHERE digest IS NULL;

ALTER TABLE billing.billing_webhook_ingress_rejections
    ALTER COLUMN digest SET NOT NULL,
    ALTER COLUMN classification SET NOT NULL,
    DROP COLUMN attempted_body;

ALTER TABLE billing.billing_webhook_ingress_rejections
    ADD CONSTRAINT billing_webhook_ingress_rejections_classification_check CHECK (
        classification IN ('empty', 'form', 'json', 'text', 'binary', 'invalid')
    );

INSERT INTO athena_billing_migrations (version, name, checksum)
SELECT 37, 'billing_webhook_ingress_bounded_evidence',
       'billing-webhook-ingress-bounded-evidence-v1'
WHERE NOT EXISTS (
    SELECT 1 FROM athena_billing_migrations WHERE version = 37
);
