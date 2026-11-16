-- #654: Verbindungen für den FinTS-Abruf ändern sich (Status, letzter Abruf, BPD und UPD); jede Änderung ins
-- Protokoll, die verschlüsselte PIN in ciphertext bleibt draußen (haben_audit).
CREATE TRIGGER fints_connections_audit AFTER INSERT OR UPDATE OR DELETE ON fints_connections
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE TRIGGER fints_connections_no_truncate BEFORE TRUNCATE ON fints_connections
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
