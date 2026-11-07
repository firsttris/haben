-- Custom SQL migration file, put your code below! --
-- Archivkopien und nachgereichte Dateien bleiben unverändert; Ergänzungen sind neue Zeilen.
CREATE TRIGGER legacy_order_documents_append_only BEFORE UPDATE OR DELETE ON legacy_order_documents
  FOR EACH ROW EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
CREATE TRIGGER legacy_order_files_append_only BEFORE UPDATE OR DELETE ON legacy_order_files
  FOR EACH ROW EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
CREATE TRIGGER legacy_order_documents_audit AFTER INSERT ON legacy_order_documents
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE TRIGGER legacy_order_files_audit AFTER INSERT ON legacy_order_files
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
