-- SMTP-Zugang mit Audit (das verschlüsselte Passwort in der Spalte ciphertext bleibt draußen),
-- gesendete E-Mails nur anhängen.

CREATE TRIGGER mail_settings_audit AFTER INSERT OR UPDATE OR DELETE ON mail_settings
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE TRIGGER mail_log_append_only BEFORE UPDATE OR DELETE ON mail_log
  FOR EACH ROW EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
CREATE TRIGGER mail_log_audit AFTER INSERT ON mail_log
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
