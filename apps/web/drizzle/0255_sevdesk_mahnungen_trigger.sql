-- Archivierte Mahnungen und ihre Dateien bleiben unverändert; Ergänzungen sind neue Zeilen.
CREATE TRIGGER legacy_dunnings_append_only BEFORE UPDATE OR DELETE ON legacy_dunnings
  FOR EACH ROW EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
CREATE TRIGGER legacy_dunning_files_append_only BEFORE UPDATE OR DELETE ON legacy_dunning_files
  FOR EACH ROW EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
CREATE TRIGGER legacy_dunnings_audit AFTER INSERT ON legacy_dunnings
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE TRIGGER legacy_dunning_files_audit AFTER INSERT ON legacy_dunning_files
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE TRIGGER legacy_dunnings_no_truncate BEFORE TRUNCATE ON legacy_dunnings
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER legacy_dunning_files_no_truncate BEFORE TRUNCATE ON legacy_dunning_files
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
