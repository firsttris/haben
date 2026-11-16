-- Ablage im Dokumentenarchiv: Änderungen am Ziel im Protokoll, der verschlüsselte Wert der Kopfzeile nicht (haben_audit
-- lässt ciphertext weg). Der Lauf (last_run_at) erzeugt keinen Eintrag, nur Änderungen an der Einstellung.
CREATE TRIGGER archive_target_audit AFTER INSERT OR DELETE ON archive_target
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE TRIGGER archive_target_audit_update AFTER UPDATE OF url, file_field, header_name, ciphertext, fields, file, link_template, enabled, since ON archive_target
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE TRIGGER archive_target_no_truncate BEFORE TRUNCATE ON archive_target
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
-- Weitergaben: angelegt und jede Änderung des Ergebnisses im Protokoll; ein weiterer Fehlversuch zählt nur attempts hoch
CREATE TRIGGER archive_deliveries_audit AFTER INSERT OR DELETE ON archive_deliveries
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE TRIGGER archive_deliveries_audit_update AFTER UPDATE OF status, archive_id, link ON archive_deliveries
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE TRIGGER archive_deliveries_no_truncate BEFORE TRUNCATE ON archive_deliveries
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
