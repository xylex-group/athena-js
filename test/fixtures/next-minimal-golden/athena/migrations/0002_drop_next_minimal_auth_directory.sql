-- Forward-only: stop exposing Auth identity as a public view.
DROP VIEW IF EXISTS public.next_minimal_auth_directory;