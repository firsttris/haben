-- Was nach dem Abruf mit einer Mail geschieht (gelesen, verschoben, gelöscht) gehört zu den Einstellungen am Postfach: auch eine Änderung nur dieser Spalten kommt ins Protokoll.
DROP TRIGGER inbox_settings_audit_update ON inbox_settings;
--> statement-breakpoint
CREATE TRIGGER inbox_settings_audit_update AFTER UPDATE OF host, port, secure, username, ciphertext, folder, outbound_folder, allowed_senders, after_fetch, archive_folder, enabled ON inbox_settings
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
