export const ATHENA_AUTH_SIGNING_KEYS_SQL = `
CREATE TABLE IF NOT EXISTS athena.auth_signing_keys (
    kid TEXT PRIMARY KEY,
    issuer TEXT NOT NULL,
    status TEXT NOT NULL,
    algorithm TEXT NOT NULL DEFAULT 'ES256',
    public_jwk JSONB NOT NULL,
    private_jwk_ciphertext TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    activated_at TIMESTAMPTZ,
    retires_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_auth_signing_keys_active_issuer
    ON athena.auth_signing_keys (issuer)
    WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_auth_signing_keys_issuer_status
    ON athena.auth_signing_keys (issuer, status);
`;

export const ATHENA_AUTH_EMAIL_FAILURE_PROVENANCE_SQL = `
ALTER TABLE athena.email_send_failures
    ADD COLUMN IF NOT EXISTS error_code TEXT;
ALTER TABLE athena.email_send_failures
    ADD COLUMN IF NOT EXISTS template_id TEXT;
ALTER TABLE athena.email_send_failures
    ADD COLUMN IF NOT EXISTS template_key TEXT;
`;
