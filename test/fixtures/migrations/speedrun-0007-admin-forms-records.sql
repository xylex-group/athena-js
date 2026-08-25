CREATE OR REPLACE FUNCTION public.admin_forms_records(
  p_limit bigint DEFAULT 20,
  p_offset bigint DEFAULT 0
)
RETURNS TABLE (
  id text,
  title text,
  user_id text
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    f.id::text,
    f.title::text,
    f.user_id::text
  FROM forms.forms AS f;
$$;
