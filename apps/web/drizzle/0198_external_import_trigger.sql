-- Custom SQL migration file, put your code below! --
-- Die Herkunft ist nur anhängbar; finanzielle Auswertungen verwenden weiterhin ihre vorhandenen Quellen.
CREATE TRIGGER external_imports_append_only BEFORE UPDATE OR DELETE ON external_imports
  FOR EACH ROW EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
CREATE TRIGGER external_imports_audit AFTER INSERT ON external_imports
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE FUNCTION haben_external_imports_no_truncate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM external_imports) THEN RAISE EXCEPTION 'external_imports darf nur ergänzt werden'; END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER external_imports_no_truncate BEFORE TRUNCATE ON external_imports
  FOR EACH STATEMENT EXECUTE FUNCTION haben_external_imports_no_truncate();
