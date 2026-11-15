CREATE EXTENSION IF NOT EXISTS unaccent;--> statement-breakpoint
CREATE OR REPLACE FUNCTION haben_unaccent(t text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT public.unaccent('public.unaccent', t);
$$;
