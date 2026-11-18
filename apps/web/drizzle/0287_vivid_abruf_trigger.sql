-- #1393: Verbindungen für den Vivid-Abruf ändern sich (Status, letzter Abruf, Konten); jede Änderung ins Protokoll.
-- Der API-Schlüssel liegt verschlüsselt in ciphertext und bleibt draußen (haben_audit).
CREATE TRIGGER vivid_connections_audit AFTER INSERT OR UPDATE OR DELETE ON vivid_connections
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE TRIGGER vivid_connections_no_truncate BEFORE TRUNCATE ON vivid_connections
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
