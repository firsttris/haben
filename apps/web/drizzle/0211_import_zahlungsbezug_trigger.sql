-- Bestätigte Zahlungsbezüge bleiben wie ihre Quellbuchungen nur anhängbar, mit Ersteller im Audit-Log.
CREATE TRIGGER external_import_settlements_append_only BEFORE UPDATE OR DELETE ON external_import_settlements
  FOR EACH ROW EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
CREATE TRIGGER external_import_settlements_audit AFTER INSERT ON external_import_settlements
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE TRIGGER external_import_settlements_no_truncate BEFORE TRUNCATE ON external_import_settlements
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
