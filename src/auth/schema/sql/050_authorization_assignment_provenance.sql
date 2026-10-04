ALTER TABLE athena.authorization_member_roles
    ADD COLUMN IF NOT EXISTS source_kind TEXT;
ALTER TABLE athena.authorization_member_roles
    ADD COLUMN IF NOT EXISTS source_id TEXT;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'athena.authorization_member_roles'::regclass
          AND conname = 'authorization_member_roles_source_check'
    ) THEN
        ALTER TABLE athena.authorization_member_roles
            ADD CONSTRAINT authorization_member_roles_source_check CHECK (
                (source_kind IS NULL AND source_id IS NULL)
                OR (
                    source_kind IS NOT NULL
                    AND source_kind = 'identity_connection'
                    AND source_id IS NOT NULL
                    AND btrim(source_id) <> ''
                )
            );
    END IF;
END;
$$;
