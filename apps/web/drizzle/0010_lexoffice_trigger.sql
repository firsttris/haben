-- Archiv und Lexoffice-Übernahme sind unveränderlich; Fortschritt der Abrufe und der Schlüssel dürfen sich ändern.

CREATE TRIGGER archive_files_append_only BEFORE UPDATE OR DELETE ON archive_files
  FOR EACH ROW EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
CREATE TRIGGER datev_bookings_append_only BEFORE UPDATE OR DELETE ON datev_bookings
  FOR EACH ROW EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
CREATE TRIGGER lexoffice_vouchers_append_only BEFORE UPDATE OR DELETE ON lexoffice_vouchers
  FOR EACH ROW EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
CREATE TRIGGER lexoffice_voucher_files_append_only BEFORE UPDATE OR DELETE ON lexoffice_voucher_files
  FOR EACH ROW EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
CREATE TRIGGER archive_files_audit AFTER INSERT ON archive_files
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE TRIGGER lexoffice_imports_audit AFTER INSERT ON lexoffice_imports
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE TRIGGER lexoffice_connection_audit AFTER INSERT OR UPDATE OR DELETE ON lexoffice_connection
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
