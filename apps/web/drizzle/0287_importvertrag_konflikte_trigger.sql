-- #306 Schritt 3b: Konflikte des Importvertrags und ihre Klärung, nur anhängbar, im Änderungsprotokoll (audit_log), gegen
-- TRUNCATE gesperrt (wie import_movements)
CREATE TRIGGER import_conflicts_append_only BEFORE UPDATE OR DELETE ON import_conflicts
  FOR EACH ROW EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
CREATE TRIGGER import_conflicts_audit AFTER INSERT ON import_conflicts
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE TRIGGER import_conflicts_no_truncate BEFORE TRUNCATE ON import_conflicts
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER import_resolutions_append_only BEFORE UPDATE OR DELETE ON import_resolutions
  FOR EACH ROW EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
CREATE TRIGGER import_resolutions_audit AFTER INSERT ON import_resolutions
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE TRIGGER import_resolutions_no_truncate BEFORE TRUNCATE ON import_resolutions
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
