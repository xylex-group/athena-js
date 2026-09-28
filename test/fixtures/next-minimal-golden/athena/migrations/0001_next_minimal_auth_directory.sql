-- Application SQL that names Embedded Auth tables before those tables exist
-- on an empty database. `athena-js migrate` must apply packaged Auth first.
CREATE OR REPLACE VIEW public.next_minimal_auth_directory AS
SELECT
    u.id AS user_id,
    u.email AS email
FROM athena.users AS u;
