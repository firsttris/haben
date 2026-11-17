-- #306 Schritt 3: Quellenbindung, Lieferungen und Quellenidentität des Importvertrags, nur anhängbar, im
-- Änderungsprotokoll (audit_log), gegen TRUNCATE gesperrt (wie bank_imports und bank_transactions)
CREATE TRIGGER import_sources_append_only BEFORE UPDATE OR DELETE ON import_sources
  FOR EACH ROW EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
CREATE TRIGGER import_sources_audit AFTER INSERT ON import_sources
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE TRIGGER import_sources_no_truncate BEFORE TRUNCATE ON import_sources
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER import_batches_append_only BEFORE UPDATE OR DELETE ON import_batches
  FOR EACH ROW EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
CREATE TRIGGER import_batches_audit AFTER INSERT ON import_batches
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE TRIGGER import_batches_no_truncate BEFORE TRUNCATE ON import_batches
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER import_movements_append_only BEFORE UPDATE OR DELETE ON import_movements
  FOR EACH ROW EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
CREATE TRIGGER import_movements_audit AFTER INSERT ON import_movements
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE TRIGGER import_movements_no_truncate BEFORE TRUNCATE ON import_movements
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
