-- Archivierte Voranmeldungen und ihre Protokolle bleiben unverändert; Ergänzungen sind neue Zeilen.
CREATE TRIGGER legacy_vat_reports_append_only BEFORE UPDATE OR DELETE ON legacy_vat_reports
  FOR EACH ROW EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
CREATE TRIGGER legacy_vat_report_files_append_only BEFORE UPDATE OR DELETE ON legacy_vat_report_files
  FOR EACH ROW EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
CREATE TRIGGER legacy_vat_reports_audit AFTER INSERT ON legacy_vat_reports
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE TRIGGER legacy_vat_report_files_audit AFTER INSERT ON legacy_vat_report_files
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE TRIGGER legacy_vat_reports_no_truncate BEFORE TRUNCATE ON legacy_vat_reports
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE TRIGGER legacy_vat_report_files_no_truncate BEFORE TRUNCATE ON legacy_vat_report_files
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
