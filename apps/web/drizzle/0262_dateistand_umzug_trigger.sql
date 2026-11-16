-- Dateistand archivierter Belege (#345): nur anhängen, jede Feststellung und Bestätigung bleibt nachvollziehbar.
CREATE TRIGGER legacy_file_states_append_only BEFORE UPDATE OR DELETE ON legacy_file_states
  FOR EACH ROW EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
CREATE TRIGGER legacy_file_states_audit AFTER INSERT ON legacy_file_states
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE TRIGGER legacy_file_states_no_truncate BEFORE TRUNCATE ON legacy_file_states
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
