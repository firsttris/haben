-- Postfach-Zugang: Änderungen im Protokoll, das verschlüsselte Passwort nicht (haben_audit lässt ciphertext weg).
-- Der stündliche Abruf (last_run_at, last_error) erzeugt keinen Eintrag, nur Änderungen am Zugang.
CREATE TRIGGER inbox_settings_audit AFTER INSERT OR DELETE ON inbox_settings
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE TRIGGER inbox_settings_audit_update AFTER UPDATE OF host, port, secure, username, ciphertext, folder, enabled ON inbox_settings
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
-- Abrufprotokoll: nur anhängen
CREATE TRIGGER inbox_messages_append_only BEFORE UPDATE OR DELETE ON inbox_messages
  FOR EACH ROW EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
CREATE TRIGGER inbox_messages_audit AFTER INSERT ON inbox_messages
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
