-- Absenderfreigabe und Ausgangsordner gehören zu den Einstellungen am Postfach: auch eine Änderung nur dieser Spalten kommt ins Protokoll.
DROP TRIGGER inbox_settings_audit_update ON inbox_settings;
--> statement-breakpoint
CREATE TRIGGER inbox_settings_audit_update AFTER UPDATE OF host, port, secure, username, ciphertext, folder, outbound_folder, allowed_senders, enabled ON inbox_settings
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
