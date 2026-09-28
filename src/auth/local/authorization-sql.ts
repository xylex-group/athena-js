/** Embedded Auth generation 31 — roles, assignments, revisions, audit. */

export const ATHENA_AUTHORIZATION_ASSIGNMENT_SQL = `
CREATE TABLE IF NOT EXISTS athena.authorization_rights (
    key TEXT PRIMARY KEY,
    domain TEXT NOT NULL,
    display_name TEXT NOT NULL,
    description TEXT NOT NULL,
    scope_kind TEXT NOT NULL CHECK (scope_kind IN ('self', 'organization', 'platform')),
    risk_level TEXT NOT NULL CHECK (risk_level IN ('low', 'elevated', 'critical')),
    assignable BOOLEAN NOT NULL DEFAULT TRUE,
    source_version INTEGER NOT NULL DEFAULT 1,
    deprecated_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS athena.authorization_roles (
    id TEXT PRIMARY KEY,
    key TEXT NOT NULL,
    name TEXT NOT NULL,
    scope_kind TEXT NOT NULL CHECK (scope_kind IN ('platform', 'organization')),
    organization_id TEXT REFERENCES athena.organization (id) ON DELETE CASCADE,
    system_kind TEXT CHECK (system_kind IN ('owner', 'admin', 'member')),
    protected BOOLEAN NOT NULL DEFAULT FALSE,
    assignable BOOLEAN NOT NULL DEFAULT TRUE,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (key, organization_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_authorization_roles_platform_key
    ON athena.authorization_roles (key)
    WHERE organization_id IS NULL;
CREATE TABLE IF NOT EXISTS athena.authorization_role_rights (
    role_id TEXT NOT NULL REFERENCES athena.authorization_roles (id) ON DELETE CASCADE,
    right_key TEXT NOT NULL REFERENCES athena.authorization_rights (key),
    PRIMARY KEY (role_id, right_key)
);
CREATE TABLE IF NOT EXISTS athena.authorization_user_roles (
    user_id TEXT NOT NULL REFERENCES athena.users (id) ON DELETE CASCADE,
    role_id TEXT NOT NULL REFERENCES athena.authorization_roles (id),
    assigned_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id)
);
CREATE TABLE IF NOT EXISTS athena.authorization_member_roles (
    member_id TEXT NOT NULL REFERENCES athena.member (id) ON DELETE CASCADE,
    role_id TEXT NOT NULL REFERENCES athena.authorization_roles (id),
    assigned_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (member_id)
);
CREATE TABLE IF NOT EXISTS athena.authorization_revisions (
    scope_kind TEXT NOT NULL CHECK (scope_kind IN ('platform', 'organization')),
    organization_id TEXT REFERENCES athena.organization (id) ON DELETE CASCADE,
    revision BIGINT NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_authorization_revisions_platform
    ON athena.authorization_revisions (scope_kind)
    WHERE organization_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_authorization_revisions_organization
    ON athena.authorization_revisions (organization_id)
    WHERE organization_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS athena.authorization_audit_log (
    id TEXT PRIMARY KEY,
    actor_user_id TEXT,
    action TEXT NOT NULL,
    target_kind TEXT NOT NULL,
    target_id TEXT NOT NULL,
    organization_id TEXT,
    before_state JSONB,
    after_state JSONB,
    reason TEXT,
    trace_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_authorization_audit_created_at
    ON athena.authorization_audit_log (created_at DESC);
INSERT INTO athena.authorization_revisions (scope_kind, organization_id, revision)
SELECT 'platform', NULL, 1
WHERE NOT EXISTS (
    SELECT 1 FROM athena.authorization_revisions
    WHERE scope_kind = 'platform' AND organization_id IS NULL
);
`;

/** Embedded Auth generation 32 — assignment scope constraints. */
export const ATHENA_AUTHORIZATION_CONSTRAINTS_SQL = `
ALTER TABLE athena.authorization_roles
    DROP CONSTRAINT IF EXISTS authorization_roles_scope_organization_id;
ALTER TABLE athena.authorization_roles
    ADD CONSTRAINT authorization_roles_scope_organization_id CHECK (
        (scope_kind = 'platform' AND organization_id IS NULL)
        OR (
            scope_kind = 'organization'
            AND (
                organization_id IS NULL
                OR (organization_id IS NOT NULL AND system_kind IS NULL)
            )
        )
    );
ALTER TABLE athena.authorization_revisions
    DROP CONSTRAINT IF EXISTS authorization_revisions_scope_nullability;
ALTER TABLE athena.authorization_revisions
    ADD CONSTRAINT authorization_revisions_scope_nullability CHECK (
        (scope_kind = 'platform' AND organization_id IS NULL)
        OR (scope_kind = 'organization' AND organization_id IS NOT NULL)
    );
CREATE OR REPLACE FUNCTION athena.authorization_assert_user_role_platform()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    role_scope TEXT;
    role_org TEXT;
BEGIN
    SELECT scope_kind, organization_id INTO role_scope, role_org
    FROM athena.authorization_roles
    WHERE id = NEW.role_id;
    IF role_scope IS DISTINCT FROM 'platform' OR role_org IS NOT NULL THEN
        RAISE EXCEPTION 'user assignments require a platform role';
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS authorization_user_roles_platform ON athena.authorization_user_roles;
CREATE TRIGGER authorization_user_roles_platform
    BEFORE INSERT OR UPDATE ON athena.authorization_user_roles
    FOR EACH ROW
    EXECUTE PROCEDURE athena.authorization_assert_user_role_platform();
CREATE OR REPLACE FUNCTION athena.authorization_assert_member_role_organization()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    role_scope TEXT;
    role_org TEXT;
    member_org TEXT;
BEGIN
    SELECT scope_kind, organization_id INTO role_scope, role_org
    FROM athena.authorization_roles
    WHERE id = NEW.role_id;
    SELECT organization_id INTO member_org
    FROM athena.member
    WHERE id = NEW.member_id;
    IF role_scope IS DISTINCT FROM 'organization' THEN
        RAISE EXCEPTION 'member assignments require an organization role';
    END IF;
    IF role_org IS NOT NULL AND role_org IS DISTINCT FROM member_org THEN
        RAISE EXCEPTION 'custom role organization must match the member organization';
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS authorization_member_roles_organization ON athena.authorization_member_roles;
CREATE TRIGGER authorization_member_roles_organization
    BEFORE INSERT OR UPDATE ON athena.authorization_member_roles
    FOR EACH ROW
    EXECUTE PROCEDURE athena.authorization_assert_member_role_organization();
`;

/** Embedded Auth generation 35 — multi-role assignments. */
export const ATHENA_AUTHORIZATION_MULTI_ROLE_SQL = `
ALTER TABLE athena.authorization_user_roles
    DROP CONSTRAINT IF EXISTS authorization_user_roles_pkey;
ALTER TABLE athena.authorization_user_roles
    ADD PRIMARY KEY (user_id, role_id);
CREATE INDEX IF NOT EXISTS idx_authorization_user_roles_user
    ON athena.authorization_user_roles (user_id);
ALTER TABLE athena.authorization_member_roles
    DROP CONSTRAINT IF EXISTS authorization_member_roles_pkey;
ALTER TABLE athena.authorization_member_roles
    ADD PRIMARY KEY (member_id, role_id);
CREATE INDEX IF NOT EXISTS idx_authorization_member_roles_member
    ON athena.authorization_member_roles (member_id);
`;
