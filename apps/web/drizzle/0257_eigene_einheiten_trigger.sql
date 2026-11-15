-- Eigene Einheiten (#748): Entwürfe, Artikel und Vorlagen verweisen über die Bezeichnung darauf. Darum weder löschen noch
-- Bezeichnung oder Code ändern, nur archivieren. Änderungen ins Audit-Log, TRUNCATE gesperrt wie bei den übrigen Stammdaten.
CREATE FUNCTION haben_units_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Eine Einheit wird nicht gelöscht, nur archiviert' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.label IS DISTINCT FROM OLD.label OR NEW.code IS DISTINCT FROM OLD.code OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Bezeichnung und Code einer Einheit bleiben, wie angelegt' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER units_guard BEFORE UPDATE OR DELETE ON units
  FOR EACH ROW EXECUTE FUNCTION haben_units_guard();
--> statement-breakpoint
CREATE TRIGGER units_audit AFTER INSERT OR UPDATE OR DELETE ON units
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE TRIGGER units_no_truncate BEFORE TRUNCATE ON units
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
